import * as THREE from 'three'

/**
 * Single-pass isosurface renderer.
 *
 * The volume is uploaded once as a `Data3DTexture` and the surface is found in
 * the fragment shader by marching along the view ray. Compared to extracting a
 * mesh with marching cubes, this puts threshold and brightness on uniforms —
 * dragging either one is free, where a mesh would have to be rebuilt.
 *
 * World-space convention, matching the canonical volume axes:
 *   +X patient Left, +Y patient Anterior, +Z patient Superior
 * The Y flip is done in `worldToTex`, since the volume's own +y points
 * Posterior.
 */

const vertexShader = /* glsl */ `
out vec4 vNDC;

void main() {
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  vNDC = gl_Position;
}
`

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

in vec4 vNDC;

uniform sampler3D uVolume;
uniform sampler3D uMask;
uniform float uMaskActive;
uniform float uMaskOpacity;
uniform float uThreshold;
uniform float uBrightness;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uInvBoxSize;
uniform vec3 uVoxelSize;
uniform mat4 uInvViewProj;
uniform float uClipActive;
uniform vec3 uClipNormal;
uniform float uClipConstant;

layout(location = 0) out vec4 fragColor;

vec3 worldToTex(vec3 p) {
  vec3 tc = (p - uBoxMin) * uInvBoxSize;
  // Volume +Y is Posterior; world +Y is Anterior. clip.ts flips coronal index
  // the same way so the cut face stays on this sample.
  tc.y = 1.0 - tc.y;
  return tc;
}

float sampleFast(vec3 p) {
  return texture(uVolume, worldToTex(p)).r;
}

// Clamped variant for gradient taps, whose offsets can fall outside the box.
// Returning 0 there would produce a hard false edge in the shading.
float sampleSafe(vec3 p) {
  return texture(uVolume, clamp(worldToTex(p), vec3(0.0), vec3(1.0))).r;
}

vec2 intersectBox(vec3 origin, vec3 dir) {
  vec3 invDir = 1.0 / dir;
  vec3 t1 = (uBoxMin - origin) * invDir;
  vec3 t2 = (uBoxMax - origin) * invDir;
  vec3 tmin = min(t1, t2);
  vec3 tmax = max(t1, t2);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

void main() {
  // Rebuilding the ray from NDC rather than interpolating a world position
  // avoids the seams that show up along the cube's edges.
  vec2 ndc = vNDC.xy / vNDC.w;
  vec4 far = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 rayDir = normalize(far.xyz / far.w - cameraPosition);

  vec2 hit = intersectBox(cameraPosition, rayDir);
  if (hit.x >= hit.y) discard;

  float t = max(hit.x, 0.0);
  float tEnd = hit.y;

  // Keep the half-space n·p + c ≥ 0 (higher volume index is discarded).
  if (uClipActive > 0.5) {
    float side = dot(uClipNormal, cameraPosition) + uClipConstant;
    float denom = dot(uClipNormal, rayDir);
    if (abs(denom) < 1e-8) {
      if (side < 0.0) discard;
    } else {
      float tClip = -side / denom;
      if (denom > 0.0) t = max(t, tClip);
      else tEnd = min(tEnd, tClip);
    }
    if (t >= tEnd) discard;
  }

  float minVoxel = min(uVoxelSize.x, min(uVoxelSize.y, uVoxelSize.z));
  float maxVoxel = max(uVoxelSize.x, max(uVoxelSize.y, uVoxelSize.z));

  // Adaptive step: stride through empty space at roughly one voxel, then slow
  // down near the isovalue so the bisection below starts from a tight bracket.
  float fineStep = minVoxel * 0.3;
  float coarseStep = maxVoxel * 0.7;
  float prev = sampleFast(cameraPosition + rayDir * t);

  for (int i = 0; i < 1024; i++) {
    float step = mix(fineStep, coarseStep, smoothstep(0.0, 0.15, abs(prev - uThreshold)));
    t += step;
    if (t > tEnd) break;

    float value = sampleFast(cameraPosition + rayDir * t);

    if ((prev < uThreshold) != (value < uThreshold)) {
      float low = t - step;
      float high = t;
      for (int k = 0; k < 8; k++) {
        float mid = (low + high) * 0.5;
        if ((sampleFast(cameraPosition + rayDir * mid) < uThreshold) == (prev < uThreshold)) low = mid;
        else high = mid;
      }
      vec3 surface = cameraPosition + rayDir * (low + high) * 0.5;

      vec3 e = uVoxelSize;
      vec3 grad = vec3(
        sampleSafe(surface + vec3(e.x, 0.0, 0.0)) - sampleSafe(surface - vec3(e.x, 0.0, 0.0)),
        sampleSafe(surface + vec3(0.0, e.y, 0.0)) - sampleSafe(surface - vec3(0.0, e.y, 0.0)),
        sampleSafe(surface + vec3(0.0, 0.0, e.z)) - sampleSafe(surface - vec3(0.0, 0.0, e.z))
      );
      float gradLen = length(grad);
      // A vanishing gradient would normalise to a random direction and show up
      // as speckle, so fall back to facing the camera.
      vec3 normal = gradLen > 1e-6 ? grad / gradLen : -rayDir;
      if (dot(normal, rayDir) > 0.0) normal = -normal;

      vec3 key = normalize(vec3(1.0, 1.0, 1.0));
      vec3 fill = normalize(vec3(-1.0, -0.5, -1.0));
      float lighting = 0.35
        + max(dot(normal, key), 0.0) * 0.5
        + max(dot(normal, fill), 0.0) * 0.25
        + pow(max(dot(reflect(-key, normal), -rayDir), 0.0), 32.0) * 0.15;

      vec3 color = vec3(clamp(uBrightness * 0.7 * lighting, 0.0, 1.0));

      if (uMaskActive > 0.5) {
        vec4 label = texture(uMask, worldToTex(surface));
        float alpha = label.a * uMaskOpacity;
        if (alpha > 0.01) {
          color = mix(color, label.rgb * lighting * 1.35, min(1.0, alpha * 1.3 + 0.15));
        }
      }

      fragColor = vec4(color, 1.0);
      return;
    }
    prev = value;
  }

  discard;
}
`

function makeVolumeTexture(
  data: Float32Array | Uint8Array,
  R: number,
  format: THREE.PixelFormat,
  type: THREE.TextureDataType,
): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(data, R, R, R)
  texture.format = format
  texture.type = type
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.wrapR = THREE.ClampToEdgeWrapping
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

export class VolumeRayMarcher {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial

  private texture: THREE.Data3DTexture | null = null
  /** Always a real 3D texture — WebGL2 can lock the tab if `sampler3D` goes unbound. */
  private readonly emptyMask: THREE.Data3DTexture
  /** Last uploaded label cube. Kept across hide so toggling does not re-upload. */
  private uploadedMask: THREE.Data3DTexture | null = null
  private maskContentKey: string | null = null
  private readonly viewProjection = new THREE.Matrix4()
  private readonly inverseViewProjection = new THREE.Matrix4()

  constructor() {
    this.emptyMask = makeVolumeTexture(new Uint8Array(4), 1, THREE.RGBAFormat, THREE.UnsignedByteType)
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uVolume: { value: null },
        uMask: { value: this.emptyMask },
        uMaskActive: { value: 0 },
        uMaskOpacity: { value: 1 },
        uThreshold: { value: 0.3 },
        uBrightness: { value: 1 },
        uBoxMin: { value: new THREE.Vector3(-1, -1, -1) },
        uBoxMax: { value: new THREE.Vector3(1, 1, 1) },
        uInvBoxSize: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uVoxelSize: { value: new THREE.Vector3(1, 1, 1) },
        uInvViewProj: { value: new THREE.Matrix4() },
        uClipActive: { value: 0 },
        uClipNormal: { value: new THREE.Vector3(0, 0, -1) },
        uClipConstant: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      // Rendering the inside of the cube guarantees a fragment for every ray
      // that enters it, including when the camera is inside the volume.
      side: THREE.BackSide,
      transparent: false,
      depthWrite: true,
    })

    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material)
    this.mesh.name = 'volumeRayMarcher'
    this.mesh.frustumCulled = false
  }

  /** `vol` is an `R³` cube of 0–1 intensities, x-fastest. */
  setVolume(vol: Float32Array, R: number, sizeX: number, sizeY: number, sizeZ: number): void {
    this.texture?.dispose()
    this.texture = makeVolumeTexture(new Float32Array(vol), R, THREE.RedFormat, THREE.FloatType)
    this.material.uniforms.uVolume.value = this.texture

    this.updateSize(sizeX, sizeY, sizeZ)
    this.material.uniforms.uVoxelSize.value.set(sizeX / R, sizeY / R, sizeZ / R)
  }

  /** Resize the bounding box without re-uploading the texture. */
  updateSize(sizeX: number, sizeY: number, sizeZ: number): void {
    this.material.uniforms.uBoxMin.value.set(-sizeX / 2, -sizeY / 2, -sizeZ / 2)
    this.material.uniforms.uBoxMax.value.set(sizeX / 2, sizeY / 2, sizeZ / 2)
    this.material.uniforms.uInvBoxSize.value.set(1 / sizeX, 1 / sizeY, 1 / sizeZ)
    this.mesh.scale.set(sizeX, sizeY, sizeZ)
  }

  /**
   * Refresh the inverse view-projection. Must be called after controls update
   * and before render: three.js only refreshes the camera's world matrix at
   * render time, and a one-frame-stale matrix here makes the volume appear to
   * drift against its own silhouette while orbiting.
   */
  updateCamera(camera: THREE.Camera): void {
    camera.updateWorldMatrix(true, false)
    this.inverseViewProjection.copy(camera.matrixWorld).invert()
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, this.inverseViewProjection)
    this.inverseViewProjection.copy(this.viewProjection).invert()
    this.material.uniforms.uInvViewProj.value.copy(this.inverseViewProjection)
  }

  setThreshold(t: number): void {
    this.material.uniforms.uThreshold.value = Math.min(1, Math.max(0, t))
  }

  setBrightness(b: number): void {
    this.material.uniforms.uBrightness.value = b
  }

  /**
   * Restrict marching to `n·x + constant ≥ 0`. Passing `active: false` restores
   * the full volume. Same half-space convention as three.js `clippingPlanes`.
   */
  setClipPlane(active: boolean, normal?: [number, number, number], constant?: number): void {
    this.material.uniforms.uClipActive.value = active ? 1 : 0
    if (normal) this.material.uniforms.uClipNormal.value.set(normal[0], normal[1], normal[2])
    if (constant !== undefined) this.material.uniforms.uClipConstant.value = constant
  }

  /**
   * Upload an `R³` RGBA cube. Alpha is occupancy (or a baked fade); `uMaskOpacity`
   * scales it. Same `key` as last time skips the texture upload.
   */
  setMask(data: Uint8Array, R: number, key?: string): void {
    if (key && key === this.maskContentKey && this.uploadedMask) return
    const next = makeVolumeTexture(data, R, THREE.RGBAFormat, THREE.UnsignedByteType)
    const previous = this.uploadedMask
    this.uploadedMask = next
    this.maskContentKey = key ?? null
    if (this.material.uniforms.uMaskActive.value > 0.5) {
      this.material.uniforms.uMask.value = next
    }
    previous?.dispose()
  }

  /**
   * Hide without disposing the uploaded cube. The 1×1×1 placeholder stays bound
   * so `sampler3D` is never unbound. Show rebinds the last upload when present.
   */
  setMaskActive(active: boolean): void {
    if (active && this.uploadedMask) {
      this.material.uniforms.uMask.value = this.uploadedMask
      this.material.uniforms.uMaskActive.value = 1
      return
    }
    this.material.uniforms.uMaskActive.value = 0
    this.material.uniforms.uMask.value = this.emptyMask
  }

  setMaskOpacity(opacity: number): void {
    this.material.uniforms.uMaskOpacity.value = Math.min(1, Math.max(0, opacity))
  }

  /** Drop the uploaded cube entirely (overlays removed, not merely hidden). */
  clearMask(): void {
    this.material.uniforms.uMaskActive.value = 0
    this.material.uniforms.uMask.value = this.emptyMask
    this.uploadedMask?.dispose()
    this.uploadedMask = null
    this.maskContentKey = null
  }

  dispose(): void {
    this.clearMask()
    this.emptyMask.dispose()
    this.texture?.dispose()
    this.texture = null
    this.material.dispose()
    this.mesh.geometry.dispose()
  }
}

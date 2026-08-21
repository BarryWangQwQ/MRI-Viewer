import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Axis, DisplayParams, MaskOverlay, Volume } from '../types'
import { resampleToCube } from '../render/slice'
import { maskVolumeContentKey, maskVolumePresentation, packedMaskVolume } from '../render/overlay'
import { paintSlice } from '../render/paintSlice'
import { sliceCapPose, sliceClipPlane, type SliceCapBasis } from '../render/clip'
import { VolumeRayMarcher } from '../three/volumeRayMarcher'
import { buildIsoMesh, type IsoMesh } from '../three/meshBuilder'
import type { WorkerResponse } from '../three/marchingCubes.worker'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const DEFAULT_VOLUME_RESOLUTION = 96

export interface VolumeViewProps {
  volume: Volume
  overlays?: MaskOverlay[]
  display: DisplayParams
  /** `gpu` ray-marches in a shader; `mesh` extracts a triangle mesh. */
  mode?: 'gpu' | 'mesh'
  /** Isosurface level in 0–1. Defaults to the window centre. */
  isoThreshold?: number
  /** Edge length of the cube the volume is resampled onto. */
  resolution?: number
  /**
   * Cut the volume open at this orthogonal slice and paint the cut face —
   * windowed grayscale plus masks. This is how interior labels become visible
   * in 3D: an isosurface alone can only show the first threshold crossing.
   */
  clipAxis?: Axis
  clipIndex?: number
  clipEnabled?: boolean
  className?: string
}

interface SceneState {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  marcher: VolumeRayMarcher | null
  mesh: THREE.Mesh | null
  clipPlane: THREE.Plane
  capMesh: THREE.Mesh
  capTexture: THREE.CanvasTexture
  frame: number
}

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

/**
 * Interactive 3D rendering of the volume.
 *
 * Both modes draw into the same world space (+X Left, +Y Anterior, +Z Superior,
 * centred on the origin), so switching between them leaves the camera where it
 * was. GPU mode is preferred because threshold changes are then a uniform update
 * rather than a re-extraction; mesh mode exists for WebGL1 contexts and for
 * hosts that want real geometry.
 */
export function VolumeView({
  volume,
  overlays,
  display,
  mode = 'gpu',
  isoThreshold,
  resolution = DEFAULT_VOLUME_RESOLUTION,
  clipAxis = 'axial',
  clipIndex,
  clipEnabled = false,
  className,
}: VolumeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SceneState | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestRef = useRef(0)

  const [status, setStatus] = useState<'idle' | 'building' | 'ready' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const webgl2 = useMemo(supportsWebGL2, [])
  const effectiveMode = mode === 'gpu' && !webgl2 ? 'mesh' : mode

  const cube = useMemo(() => resampleToCube(volume, resolution), [volume, resolution])

  const extent = useMemo<[number, number, number]>(
    () => [
      volume.cols * volume.spacing[0],
      volume.rows * volume.spacing[1],
      volume.slices * volume.spacing[2],
    ],
    [volume],
  )

  /**
   * Isosurface level. The cube is normalised against the volume's full intensity
   * range, so the window centre maps into it directly and gives a threshold that
   * already shows something recognisable.
   */
  const threshold = useMemo(() => {
    if (isoThreshold !== undefined) return Math.max(0, Math.min(1, isoThreshold))
    const range = volume.max - volume.min || 1
    return Math.max(0.05, Math.min(0.95, (display.windowCenter - volume.min) / range))
  }, [isoThreshold, display.windowCenter, volume.min, volume.max])

  const brightness = Math.max(0.3, Math.min(2.5, display.gamma || 1))

  /* ── Scene lifecycle ────────────────────────────────────────────────────── */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    // Patient Superior is up; without this three.js would put Anterior up.
    camera.up.set(0, 0, 1)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.localClippingEnabled = true
    container.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.rotateSpeed = 0.9

    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const key = new THREE.DirectionalLight(0xffffff, 0.85)
    key.position.set(1, 1, 1)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.35)
    fill.position.set(-1, -0.5, -1)
    scene.add(fill)

    const capCanvas = document.createElement('canvas')
    capCanvas.width = 1
    capCanvas.height = 1
    const capTexture = new THREE.CanvasTexture(capCanvas)
    capTexture.colorSpace = THREE.NoColorSpace
    capTexture.minFilter = THREE.LinearFilter
    capTexture.magFilter = THREE.LinearFilter
    capTexture.generateMipmaps = false
    capTexture.flipY = true
    const capMaterial = new THREE.MeshBasicMaterial({
      map: capTexture,
      transparent: true,
      depthWrite: true,
      // Discard empty FOV so linear filtering cannot leave a black card.
      alphaTest: 0.08,
      premultipliedAlpha: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    const capMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), capMaterial)
    capMesh.name = 'sliceCap'
    capMesh.visible = false
    capMesh.renderOrder = 1
    scene.add(capMesh)

    const state: SceneState = {
      scene,
      camera,
      renderer,
      controls,
      marcher: null,
      mesh: null,
      clipPlane: new THREE.Plane(),
      capMesh,
      capTexture,
      frame: 0,
    }
    sceneRef.current = state

    const resize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    const animate = () => {
      state.frame = requestAnimationFrame(animate)
      controls.update()
      state.marcher?.updateCamera(camera)
      renderer.render(scene, camera)
    }
    state.frame = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(state.frame)
      observer.disconnect()
      controls.dispose()
      state.marcher?.dispose()
      if (state.mesh) {
        state.mesh.geometry.dispose()
        ;(state.mesh.material as THREE.Material).dispose()
      }
      state.capMesh.geometry.dispose()
      ;(state.capMesh.material as THREE.Material).dispose()
      state.capTexture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      sceneRef.current = null
    }
  }, [])

  /* ── Camera framing ─────────────────────────────────────────────────────── */

  useEffect(() => {
    const state = sceneRef.current
    if (!state) return

    const radius = 0.5 * Math.hypot(extent[0], extent[1], extent[2])
    const distance = (radius / Math.sin((state.camera.fov * Math.PI) / 360)) * 1.05

    state.camera.near = Math.max(0.1, distance - radius * 2)
    state.camera.far = distance + radius * 4
    // Anterior-superior-left oblique, the closest thing to a conventional
    // "first look" at a head volume.
    state.camera.position.set(distance * 0.42, distance * 0.82, distance * 0.38)
    state.camera.updateProjectionMatrix()
    state.controls.target.set(0, 0, 0)
    state.controls.minDistance = radius * 0.2
    state.controls.maxDistance = distance * 4
    state.controls.update()
  }, [extent])

  /* ── Volume upload ──────────────────────────────────────────────────────── */

  /*
   * Deliberately independent of `threshold` and `brightness`. Uploading a
   * Data3DTexture is the expensive part of GPU mode, and re-running it while the
   * user drags the threshold slider would throw away the exact advantage the
   * shader path exists for. Those two are applied as uniforms below instead.
   */
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return

    if (effectiveMode === 'gpu') {
      if (state.mesh) {
        state.scene.remove(state.mesh)
        state.mesh.geometry.dispose()
        ;(state.mesh.material as THREE.Material).dispose()
        state.mesh = null
      }
      if (!state.marcher) {
        state.marcher = new VolumeRayMarcher()
        state.scene.add(state.marcher.mesh)
      }
      state.marcher.setVolume(cube, resolution, extent[0], extent[1], extent[2])
      setStatus('ready')
      setMessage(null)
      return
    }

    if (state.marcher) {
      state.scene.remove(state.marcher.mesh)
      state.marcher.dispose()
      state.marcher = null
    }
    workerRef.current?.postMessage({ type: 'setVolume', vol: cube, R: resolution })
  }, [cube, resolution, effectiveMode, extent])

  /* ── GPU parameter updates (a uniform write, so dragging is free) ───────── */

  useEffect(() => {
    const marcher = sceneRef.current?.marcher
    if (!marcher) return
    marcher.setThreshold(threshold)
    marcher.setBrightness(brightness)
  }, [threshold, brightness, effectiveMode, cube])

  const maskPackKey = maskVolumeContentKey(overlays, resolution)
  const packedMask = useMemo(
    () => packedMaskVolume(overlays, resolution),
    // Content key ignores visibility / opacity so a hide or fade is a uniform write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maskPackKey],
  )
  const { active: maskActive, opacity: maskOpacity } = maskVolumePresentation(overlays)

  useEffect(() => {
    const marcher = sceneRef.current?.marcher
    if (!marcher) return
    if (!packedMask) {
      marcher.clearMask()
      return
    }
    marcher.setMask(packedMask, resolution, maskPackKey)
  }, [packedMask, maskPackKey, resolution, effectiveMode, cube])

  useEffect(() => {
    const marcher = sceneRef.current?.marcher
    if (!marcher) return
    marcher.setMaskActive(maskActive)
    marcher.setMaskOpacity(maskOpacity)
  }, [maskActive, maskOpacity, packedMask, effectiveMode, cube])

  /* ── Slice clip + painted cut face ──────────────────────────────────────── */

  useEffect(() => {
    const state = sceneRef.current
    if (!state) return

    const total =
      clipAxis === 'axial' ? volume.slices : clipAxis === 'coronal' ? volume.rows : volume.cols
    const index = Math.max(0, Math.min(total - 1, Math.round(clipIndex ?? (total >> 1))))

    if (!clipEnabled) {
      state.marcher?.setClipPlane(false)
      if (state.mesh) {
        const material = state.mesh.material as THREE.MeshStandardMaterial
        material.clippingPlanes = []
        material.needsUpdate = true
      }
      state.capMesh.visible = false
      return
    }

    const plane = sliceClipPlane(volume, clipAxis, index)
    state.clipPlane.set(new THREE.Vector3(...plane.normal), plane.constant)
    state.marcher?.setClipPlane(true, plane.normal, plane.constant)
    if (state.mesh) {
      const material = state.mesh.material as THREE.MeshStandardMaterial
      material.clippingPlanes = [state.clipPlane]
      material.needsUpdate = true
    }

    const pose = sliceCapPose(volume, clipAxis, index)
    orientCap(state.capMesh, pose.basis)
    state.capMesh.scale.set(pose.size[0], pose.size[1], 1)
    state.capMesh.position.set(...pose.position)

    const image = paintSlice(volume, clipAxis, index, display, overlays, {
      transparentBackground: true,
    })
    const canvas = state.capTexture.image as HTMLCanvasElement
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d', { alpha: true })?.putImageData(image, 0, 0)
    state.capTexture.needsUpdate = true
    state.capMesh.visible = true
  }, [clipEnabled, clipAxis, clipIndex, volume, display, overlays, effectiveMode, cube])

  /* ── Mesh extraction ────────────────────────────────────────────────────── */

  useEffect(() => {
    if (effectiveMode !== 'mesh') return

    if (!workerRef.current) {
      try {
        workerRef.current = new Worker(new URL('../three/marchingCubes.worker.ts', import.meta.url), {
          type: 'module',
        })
      } catch {
        // Bundlers that cannot emit the worker chunk fall through to the
        // synchronous path below rather than losing mesh mode entirely.
        workerRef.current = null
      }
      workerRef.current?.postMessage({ type: 'setVolume', vol: cube, R: resolution })
    }

    const state = sceneRef.current
    if (!state) return

    const requestId = ++requestRef.current
    setStatus('building')
    setMessage(null)

    const install = (mesh: IsoMesh | null) => {
      if (requestId !== requestRef.current) return
      const current = sceneRef.current
      if (!current) return

      if (current.mesh) {
        current.scene.remove(current.mesh)
        current.mesh.geometry.dispose()
        ;(current.mesh.material as THREE.Material).dispose()
        current.mesh = null
      }

      if (!mesh) {
        setStatus('error')
        setMessage('No surface at this threshold.')
        return
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
      geometry.computeBoundingSphere()

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.82 * brightness, 0.80 * brightness, 0.78 * brightness),
        roughness: 0.62,
        metalness: 0.04,
        side: THREE.DoubleSide,
        clippingPlanes: clipEnabled ? [current.clipPlane] : [],
      })

      const object = new THREE.Mesh(geometry, material)
      object.name = 'isoSurface'
      current.scene.add(object)
      current.mesh = object
      setStatus('ready')
    }

    const worker = workerRef.current
    if (!worker) {
      // Synchronous fallback. Yield first so the loading state can paint.
      const timer = setTimeout(() => {
        try {
          install(
            buildIsoMesh(
              cube,
              resolution,
              threshold,
              resolution,
              volume.cols,
              volume.rows,
              volume.slices,
              volume.spacing,
            ),
          )
        } catch (error) {
          setStatus('error')
          setMessage(error instanceof Error ? error.message : String(error))
        }
      }, 0)
      return () => clearTimeout(timer)
    }

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data
      if (data.requestId !== requestId) return
      if (data.type === 'result') install({ positions: data.positions, normals: data.normals, indices: data.indices })
      else if (data.type === 'empty') install(null)
      else {
        setStatus('error')
        setMessage(data.message)
      }
    }

    worker.addEventListener('message', onMessage)
    worker.postMessage({
      type: 'build',
      requestId,
      threshold,
      mcR: resolution,
      cols: volume.cols,
      rows: volume.rows,
      slices: volume.slices,
      spacing: volume.spacing,
    })

    return () => worker.removeEventListener('message', onMessage)
  }, [effectiveMode, cube, resolution, threshold, brightness, volume])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative min-h-0 min-w-0 flex-1 overflow-hidden overscroll-contain bg-[var(--viewer-canvas)]',
        className,
      )}
    >
      {status === 'building' ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Skeleton className="h-24 w-24 rounded-full" />
        </div>
      ) : null}

      {status === 'error' && message ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-muted-foreground">
          {message}
        </div>
      ) : null}

      <div className="pointer-events-none absolute top-1 left-1 font-mono text-[10px] tracking-wide text-[var(--viewer-canvas-foreground)]/70 uppercase">
        3D · {effectiveMode === 'gpu' ? 'ray marching' : 'marching cubes'}
        {clipEnabled ? ' · clipped' : ''}
        {mode === 'gpu' && !webgl2 ? ' (webgl2 unavailable)' : ''}
      </div>
    </div>
  )
}

const _basis = new THREE.Matrix4()
const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()

/** Apply the clip.ts basis so Cor/Sag stay locked to paintSlice. */
function orientCap(mesh: THREE.Mesh, basis: SliceCapBasis): void {
  _x.set(...basis.x)
  _y.set(...basis.y)
  _z.set(...basis.z)
  mesh.quaternion.setFromRotationMatrix(_basis.makeBasis(_x, _y, _z))
}


import type { Volume } from '../types'

/** Voxel dimension a plane is cut along. */
export type Dim = 'x' | 'y' | 'z'

export function voxelIndex(vol: Volume, x: number, y: number, z: number): number {
  return x + y * vol.cols + z * vol.cols * vol.rows
}

/**
 * Size and voxel-to-pixel mapping of an orthogonal cut, in *display* space.
 *
 * The flips encoded here are the whole reason radiological convention comes out
 * right, and they are defined once so that grayscale planes and label planes can
 * never drift apart. Given the canonical volume axes (+x Left, +y Posterior,
 * +z Superior):
 *
 *   cut along z (axial)    → width x (R→L), height y (A→P)      no flips
 *   cut along y (coronal)  → width x (R→L), height z (S→I)      flip height
 *   cut along x (sagittal) → width y (A→P), height z (S→I)      flip height
 */
export function planeGeometry(dims: [number, number, number], dim: Dim) {
  const [cols, rows, slices] = dims
  switch (dim) {
    case 'z':
      return { width: cols, height: rows, flipH: false }
    case 'y':
      return { width: cols, height: slices, flipH: true }
    case 'x':
      return { width: rows, height: slices, flipH: true }
  }
}

/** Display-space pixel `(w, h)` of a cut → voxel coordinate. */
export function planeToVoxel(
  dims: [number, number, number],
  dim: Dim,
  index: number,
  w: number,
  h: number,
): [number, number, number] {
  const { height, flipH } = planeGeometry(dims, dim)
  const sh = flipH ? height - 1 - h : h
  switch (dim) {
    case 'z':
      return [w, sh, index]
    case 'y':
      return [w, index, sh]
    case 'x':
      return [index, w, sh]
  }
}

/** Voxel coordinate → display-space pixel of the cut through it. */
export function voxelToPlane(
  dims: [number, number, number],
  dim: Dim,
  voxel: [number, number, number],
): { w: number; h: number } {
  const { height, flipH } = planeGeometry(dims, dim)
  const [x, y, z] = voxel
  const raw = dim === 'z' ? { w: x, h: y } : dim === 'y' ? { w: x, h: z } : { w: y, h: z }
  return { w: raw.w, h: flipH ? height - 1 - raw.h : raw.h }
}

/** Depth of the volume along the dimension a cut is taken across. */
export function dimExtent(dims: [number, number, number], dim: Dim): number {
  return dim === 'x' ? dims[0] : dim === 'y' ? dims[1] : dims[2]
}

/**
 * Copy one orthogonal cut out of a linearly indexed 3D array.
 *
 * Generic over Float32Array intensities and integer label arrays so the index
 * arithmetic exists in exactly one place.
 */
function cutPlane<T extends { length: number; [i: number]: number }>(
  source: T,
  dims: [number, number, number],
  dim: Dim,
  index: number,
  out: { [i: number]: number },
): void {
  const [cols, rows, slices] = dims
  const { width, height, flipH } = planeGeometry(dims, dim)
  const sliceStride = cols * rows

  const depth = dim === 'x' ? cols : dim === 'y' ? rows : slices
  const at = Math.max(0, Math.min(depth - 1, Math.round(index)))

  for (let h = 0; h < height; h++) {
    const sh = flipH ? height - 1 - h : h
    const rowOffset = h * width
    for (let w = 0; w < width; w++) {
      let src: number
      switch (dim) {
        case 'z':
          src = w + sh * cols + at * sliceStride
          break
        case 'y':
          src = w + at * cols + sh * sliceStride
          break
        case 'x':
          src = at + w * cols + sh * sliceStride
          break
      }
      out[rowOffset + w] = source[src]
    }
  }
}

function extract(vol: Volume, dim: Dim, index: number): Float32Array {
  const dims: [number, number, number] = [vol.cols, vol.rows, vol.slices]
  const { width, height } = planeGeometry(dims, dim)
  const out = new Float32Array(width * height)
  cutPlane(vol.data, dims, dim, index, out)
  return out
}

/** Axial cut at slice `z`, oriented R→L across and A→P down. */
export function extractAxial(vol: Volume, z: number): Float32Array {
  return extract(vol, 'z', z)
}

/** Coronal cut at row `y`, oriented R→L across and S→I down. */
export function extractCoronal(vol: Volume, y: number): Float32Array {
  return extract(vol, 'y', y)
}

/** Sagittal cut at column `x`, oriented A→P across and S→I down. */
export function extractSagittal(vol: Volume, x: number): Float32Array {
  return extract(vol, 'x', x)
}

/** Internal: shared by the label-plane sampler so both use identical geometry. */
export function cutLabelPlane(
  labels: Uint8Array | Uint16Array,
  dims: [number, number, number],
  dim: Dim,
  index: number,
): Uint16Array {
  const { width, height } = planeGeometry(dims, dim)
  const out = new Uint16Array(width * height)
  cutPlane(labels, dims, dim, index, out)
  return out
}

/**
 * Resample the volume onto an `R³` grid with values normalised to 0–1, which is
 * the input format both the ray marcher and marching cubes expect.
 *
 * The cube is indexed x-fastest, matching `THREE.Data3DTexture`. A light
 * separable Gaussian follows the resample: without it the isosurface picks up
 * the slice spacing as visible terracing, which is the single most obvious
 * artefact in anisotropic MR series.
 */
export function resampleToCube(vol: Volume, R: number): Float32Array {
  const { cols, rows, slices, data, min, max } = vol
  const range = max - min || 1
  const cube = new Float32Array(R * R * R)

  const sx = (cols - 1) / Math.max(1, R - 1)
  const sy = (rows - 1) / Math.max(1, R - 1)
  const sz = (slices - 1) / Math.max(1, R - 1)
  const sliceStride = cols * rows

  for (let k = 0; k < R; k++) {
    const fz = k * sz
    const z0 = Math.min(slices - 1, fz | 0)
    const z1 = Math.min(slices - 1, z0 + 1)
    const tz = fz - z0
    for (let j = 0; j < R; j++) {
      const fy = j * sy
      const y0 = Math.min(rows - 1, fy | 0)
      const y1 = Math.min(rows - 1, y0 + 1)
      const ty = fy - y0
      const base = k * R * R + j * R
      for (let i = 0; i < R; i++) {
        const fx = i * sx
        const x0 = Math.min(cols - 1, fx | 0)
        const x1 = Math.min(cols - 1, x0 + 1)
        const tx = fx - x0

        const z0o = z0 * sliceStride
        const z1o = z1 * sliceStride
        const y0o = y0 * cols
        const y1o = y1 * cols

        const c00 = data[x0 + y0o + z0o] + (data[x1 + y0o + z0o] - data[x0 + y0o + z0o]) * tx
        const c10 = data[x0 + y1o + z0o] + (data[x1 + y1o + z0o] - data[x0 + y1o + z0o]) * tx
        const c01 = data[x0 + y0o + z1o] + (data[x1 + y0o + z1o] - data[x0 + y0o + z1o]) * tx
        const c11 = data[x0 + y1o + z1o] + (data[x1 + y1o + z1o] - data[x0 + y1o + z1o]) * tx
        const c0 = c00 + (c10 - c00) * ty
        const c1 = c01 + (c11 - c01) * ty

        cube[base + i] = (c0 + (c1 - c0) * tz - min) / range
      }
    }
  }

  return blur3(cube, R)
}

/** Separable 5-tap Gaussian (σ ≈ 1.2 voxels) applied in place-ish. */
function blur3(vol: Float32Array, R: number): Float32Array {
  const kernel = [0.0625, 0.25, 0.375, 0.25, 0.0625]
  const radius = 2
  const R2 = R * R
  let src = vol
  let dst = new Float32Array(vol.length)

  for (let axis = 0; axis < 3; axis++) {
    const stride = axis === 0 ? 1 : axis === 1 ? R : R2
    for (let k = 0; k < R; k++) {
      for (let j = 0; j < R; j++) {
        for (let i = 0; i < R; i++) {
          const idx = k * R2 + j * R + i
          const coord = axis === 0 ? i : axis === 1 ? j : k
          let sum = 0
          for (let t = -radius; t <= radius; t++) {
            const c = coord + t
            const clamped = c < 0 ? 0 : c > R - 1 ? R - 1 : c
            sum += src[idx + (clamped - coord) * stride] * kernel[t + radius]
          }
          dst[idx] = sum
        }
      }
    }
    const swap = src
    src = dst
    dst = swap
  }

  return src
}

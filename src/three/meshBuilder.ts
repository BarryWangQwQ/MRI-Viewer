import * as mcf from 'marching-cubes-fast'

export interface IsoMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

/**
 * Largest power of two not exceeding `n`, within the range the grid is useful in.
 *
 * `marching-cubes-fast` only accepts power-of-two grids, and the volume
 * resolution it is called with (96 by default) usually is not one. Rounding down
 * rather than up keeps the grid at or below the sampled cube, where rounding up
 * would only oversample data that has no more detail to give.
 */
function powerOfTwoGrid(n: number): number {
  const clamped = Math.max(16, Math.min(256, Math.floor(n)))
  return 2 ** Math.floor(Math.log2(clamped))
}

/**
 * Extract an isosurface with marching cubes.
 *
 * `vol` is the `R³` cube produced by `resampleToCube`; `mcR` is the requested
 * marching cubes grid, decoupled from `R` so quality can be traded against time
 * without resampling the volume again. It is snapped down to a power of two.
 *
 * Vertices come out in the same world space the ray marcher uses, so the two
 * volume modes are interchangeable without touching the camera:
 *   +X Left, +Y Anterior (hence the flipped y), +Z Superior, centred on origin.
 */
export function buildIsoMesh(
  vol: Float32Array,
  R: number,
  threshold: number,
  requestedGrid: number,
  cols: number,
  rows: number,
  slices: number,
  spacing: [number, number, number],
): IsoMesh | null {
  const mcR = powerOfTwoGrid(requestedGrid)
  const R2 = R * R
  const scale = R / mcR

  const sampleAt = (x: number, y: number, z: number): number => {
    const fx = Math.max(0, Math.min(R - 1.001, x))
    const fy = Math.max(0, Math.min(R - 1.001, y))
    const fz = Math.max(0, Math.min(R - 1.001, z))
    const x0 = fx | 0
    const y0 = fy | 0
    const z0 = fz | 0
    const tx = fx - x0
    const ty = fy - y0
    const tz = fz - z0

    const a = z0 * R2 + y0 * R + x0
    const b = a + R2
    const c00 = vol[a] + (vol[a + 1] - vol[a]) * tx
    const c10 = vol[a + R] + (vol[a + R + 1] - vol[a + R]) * tx
    const c01 = vol[b] + (vol[b + 1] - vol[b]) * tx
    const c11 = vol[b + R] + (vol[b + R + 1] - vol[b + R]) * tx
    const c0 = c00 + (c10 - c00) * ty
    const c1 = c01 + (c11 - c01) * ty
    return c0 + (c1 - c0) * tz
  }

  // Negative inside the surface, which is the sign convention the library wants.
  const sdf = (x: number, y: number, z: number): number =>
    threshold - sampleAt(x * scale, y * scale, z * scale)

  const result = mcf.marchingCubes(mcR, sdf, [
    [0, 0, 0],
    [mcR, mcR, mcR],
  ])

  const vertexCount = result.positions.length
  const faceCount = result.cells.length
  if (!vertexCount || !faceCount) return null

  const extentX = cols * spacing[0]
  const extentY = rows * spacing[1]
  const extentZ = slices * spacing[2]

  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const eps = 0.5

  for (let i = 0; i < vertexCount; i++) {
    const [mx, my, mz] = result.positions[i]

    positions[i * 3] = (mx / mcR - 0.5) * extentX
    positions[i * 3 + 1] = (0.5 - my / mcR) * extentY
    positions[i * 3 + 2] = (mz / mcR - 0.5) * extentZ

    const vx = mx * scale
    const vy = my * scale
    const vz = mz * scale
    const gx = sampleAt(vx + eps, vy, vz) - sampleAt(vx - eps, vy, vz)
    const gy = sampleAt(vx, vy + eps, vz) - sampleAt(vx, vy - eps, vz)
    const gz = sampleAt(vx, vy, vz + eps) - sampleAt(vx, vy, vz - eps)

    // Outward is where intensity falls off, transformed into world space: the
    // per-axis division handles anisotropic spacing, and the sign flips follow
    // the position mapping above.
    let nx = -gx / spacing[0]
    let ny = gy / spacing[1]
    let nz = -gz / spacing[2]
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length

    normals[i * 3] = nx
    normals[i * 3 + 1] = ny
    normals[i * 3 + 2] = nz
  }

  const indices = new Uint32Array(faceCount * 3)
  for (let i = 0; i < faceCount; i++) {
    const cell = result.cells[i]
    indices[i * 3] = cell[0]
    indices[i * 3 + 1] = cell[1]
    indices[i * 3 + 2] = cell[2]
  }

  return { positions, normals, indices }
}

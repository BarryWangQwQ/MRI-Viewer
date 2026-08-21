/**
 * Reorientation to the canonical voxel axes documented on `Volume`.
 *
 * Real-world input is all over the place: NIfTI files show up in RAS, LAS and
 * occasionally something obliquely rotated, and DICOM series are routinely
 * acquired sagittally or coronally. Rather than teaching every view to consult
 * an affine, the volume is permuted and flipped once at load time so that
 * afterwards +x is always patient Left, +y Posterior and +z Superior.
 */

export type Vec3 = [number, number, number]

export interface OrientedVolume {
  data: Float32Array
  dims: [number, number, number]
  spacing: [number, number, number]
  affine?: number[][]
}

/** Which anatomical axis a direction vector points along, and in which sense. */
function dominantAxis(dir: Vec3): { axis: 0 | 1 | 2; sign: 1 | -1 } {
  const a = [Math.abs(dir[0]), Math.abs(dir[1]), Math.abs(dir[2])]
  const axis: 0 | 1 | 2 = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2
  return { axis, sign: dir[axis] >= 0 ? 1 : -1 }
}

/**
 * Permute and flip a volume so its voxel axes line up with LPS.
 *
 * `dirs[i]` is the LPS-space direction that voxel axis `i` advances along.
 * Obliquely acquired data — where two voxel axes claim the same anatomical axis —
 * is returned untouched: guessing a permutation there would be worse than
 * showing the data in acquisition order.
 */
export function canonicalizeToLps(
  data: Float32Array,
  dims: [number, number, number],
  spacing: [number, number, number],
  dirs: [Vec3, Vec3, Vec3],
  origin?: Vec3,
): OrientedVolume {
  const mapping = dirs.map(dominantAxis)
  const targets = mapping.map((m) => m.axis)

  const isPermutation = new Set(targets).size === 3
  if (!isPermutation) {
    return { data, dims, spacing, affine: buildAffine(dirs, spacing, origin) }
  }

  // sourceOf[target] = which source voxel axis becomes this target axis.
  const sourceOf = [0, 0, 0] as [number, number, number]
  const flip = [false, false, false]
  for (let src = 0; src < 3; src++) {
    sourceOf[targets[src]] = src
    flip[targets[src]] = mapping[src].sign < 0
  }

  const identity = sourceOf[0] === 0 && sourceOf[1] === 1 && sourceOf[2] === 2
  if (identity && !flip[0] && !flip[1] && !flip[2]) {
    return { data, dims, spacing, affine: buildAffine(dirs, spacing, origin) }
  }

  const outDims: [number, number, number] = [
    dims[sourceOf[0]],
    dims[sourceOf[1]],
    dims[sourceOf[2]],
  ]
  const outSpacing: [number, number, number] = [
    spacing[sourceOf[0]],
    spacing[sourceOf[1]],
    spacing[sourceOf[2]],
  ]

  const out = new Float32Array(data.length)
  const srcStride: [number, number, number] = [1, dims[0], dims[0] * dims[1]]
  const [ox, oy, oz] = outDims

  // Walk the output linearly and gather from the source, so the write pattern
  // stays sequential on the larger of the two arrays.
  let w = 0
  for (let z = 0; z < oz; z++) {
    const sz = flip[2] ? oz - 1 - z : z
    const zOff = sz * srcStride[sourceOf[2]]
    for (let y = 0; y < oy; y++) {
      const sy = flip[1] ? oy - 1 - y : y
      const yOff = sy * srcStride[sourceOf[1]] + zOff
      const xStride = srcStride[sourceOf[0]]
      if (flip[0]) {
        for (let x = ox - 1; x >= 0; x--) out[w++] = data[yOff + x * xStride]
      } else {
        for (let x = 0; x < ox; x++) out[w++] = data[yOff + x * xStride]
      }
    }
  }

  return {
    data: out,
    dims: outDims,
    spacing: outSpacing,
    affine: buildCanonicalAffine(dirs, spacing, dims, sourceOf, flip, origin),
  }
}

function buildAffine(dirs: [Vec3, Vec3, Vec3], spacing: [number, number, number], origin?: Vec3) {
  const o = origin ?? [0, 0, 0]
  return [
    [dirs[0][0] * spacing[0], dirs[1][0] * spacing[1], dirs[2][0] * spacing[2], o[0]],
    [dirs[0][1] * spacing[0], dirs[1][1] * spacing[1], dirs[2][1] * spacing[2], o[1]],
    [dirs[0][2] * spacing[0], dirs[1][2] * spacing[1], dirs[2][2] * spacing[2], o[2]],
    [0, 0, 0, 1],
  ]
}

/**
 * Affine of the reoriented volume: the original voxel→world map composed with
 * the permutation and flips that were just applied.
 */
function buildCanonicalAffine(
  dirs: [Vec3, Vec3, Vec3],
  spacing: [number, number, number],
  dims: [number, number, number],
  sourceOf: [number, number, number],
  flip: boolean[],
  origin?: Vec3,
): number[][] {
  const source = buildAffine(dirs, spacing, origin)
  const result = [
    [0, 0, 0, source[0][3]],
    [0, 0, 0, source[1][3]],
    [0, 0, 0, source[2][3]],
    [0, 0, 0, 1],
  ]

  for (let target = 0; target < 3; target++) {
    const src = sourceOf[target]
    const sign = flip[target] ? -1 : 1
    for (let row = 0; row < 3; row++) {
      result[row][target] = source[row][src] * sign
      // A flipped axis starts at the far edge, so fold that offset into the origin.
      if (flip[target]) result[row][3] += source[row][src] * (dims[src] - 1)
    }
  }

  return result
}

/** NIfTI stores directions in RAS; the canonical space here is LPS. */
export function rasToLps(dir: Vec3): Vec3 {
  return [-dir[0], -dir[1], dir[2]]
}

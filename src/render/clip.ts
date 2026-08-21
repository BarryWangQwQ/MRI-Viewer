import type { Axis, Volume } from '../types'
import { sliceCount } from './planes'

export type Vec3Tuple = [number, number, number]

/**
 * World-space slice frame. This is the single mapping for clip + cap + texture
 * so Cor/Sag cannot drift from Ax (or from 2D `paintSlice`).
 *
 * Volume index: +X Left, +Y Posterior, +Z Superior.
 * World:        +X Left, +Y Anterior (`worldToTex` does `tc.y = 1.0 - tc.y`), +Z Superior.
 * Box centred on origin; extents = dims × spacing.
 *
 * `sliceWorldPosition` converts index → that world axis, flipping only Y so
 * volume row 0 (Anterior) sits at +Y. Example, mid coronal on 182×218×182 @ 1 mm
 * (index 109): t = 109/217 ≈ 0.5023 → worldY = (0.5 − t)×218 ≈ −0.50.
 *
 * Clip keeps `axis ≤ world` (three.js / shader: n·x + c ≥ 0 with n = −axis).
 * That discards the +world half — the side the default camera (+X,+Y,+Z) sits
 * on — so every plane is viewed like Ax, looking into the cut. For X/Z this is
 * higher volume index; for Y it is lower volume index because world Y is flipped.
 *
 * Cap: plane +X/+Y follow `paintSlice` after CanvasTexture.flipY (image right /
 * up). flipH already put S at the top of Cor/Sag ImageData, so plane +Y = +Z
 * (not −Z). In-plane scale is the two physical extents of that cut, not the
 * slice-axis extent (Cor is X×Z, never X×Y).
 */
export function sliceWorldPosition(volume: Volume, axis: Axis, index: number): number {
  const count = sliceCount(volume, axis)
  const clamped = Math.max(0, Math.min(count - 1, Math.round(index)))
  const t = count > 1 ? clamped / (count - 1) : 0.5
  const extent = axisExtent(volume, axis)
  // Volume +Y is Posterior; world +Y is Anterior — invert t on coronal only.
  return axis === 'coronal' ? (0.5 - t) * extent : (t - 0.5) * extent
}

export interface SliceClipPlane {
  /** Unit normal pointing toward the discarded half-space (+world axis). */
  normal: Vec3Tuple
  constant: number
}

/**
 * Half-space that keeps the −world side of the cut (`axis ≤ world`).
 *
 * Encoded as a three.js plane (`n·x + constant = 0`); fragments with
 * `n·x + constant < 0` are discarded — same convention as the ray-marcher
 * and `MeshStandardMaterial.clippingPlanes`. All three axes use n = −eᵢ,
 * constant = world, so Y cannot pick up a unique sign error.
 */
export function sliceClipPlane(volume: Volume, axis: Axis, index: number): SliceClipPlane {
  const world = sliceWorldPosition(volume, axis, index)
  if (axis === 'axial') return { normal: [0, 0, -1], constant: world }
  if (axis === 'sagittal') return { normal: [-1, 0, 0], constant: world }
  return { normal: [0, -1, 0], constant: world }
}

export interface SliceCapBasis {
  /** Image right (local +X) in world space. */
  x: Vec3Tuple
  /** Image up (local +Y) in world space. */
  y: Vec3Tuple
  /** Plane +Z, toward the discarded half (tiny cap offset). */
  z: Vec3Tuple
}

export interface SliceCapPose {
  position: Vec3Tuple
  /** Physical width (image X) and height (image Y) in millimetres. */
  size: [number, number]
  basis: SliceCapBasis
}

/**
 * Textured rectangle that closes the clipped volume.
 *
 * Offset a fraction of a voxel along the discarded (+world) side so the cap
 * sits on the cut without z-fighting the isosurface.
 */
export function sliceCapPose(volume: Volume, axis: Axis, index: number): SliceCapPose {
  const world = sliceWorldPosition(volume, axis, index)
  const [sx, sy, sz] = volume.spacing
  const extentX = volume.cols * sx
  const extentY = volume.rows * sy
  const extentZ = volume.slices * sz
  const pad = 0.2
  const basis = sliceCapBasis(axis)

  if (axis === 'axial') {
    return { position: [0, 0, world + pad * sz], size: [extentX, extentY], basis }
  }
  if (axis === 'coronal') {
    // +Y discarded: nudge toward Anterior, same sign as Ax/Sag +axis pads.
    return { position: [0, world + pad * sy, 0], size: [extentX, extentZ], basis }
  }
  return { position: [world + pad * sx, 0, 0], size: [extentY, extentZ], basis }
}

/**
 * Local XY of a THREE.PlaneGeometry → world, matching 2D SliceCanvas labels.
 *
 * CanvasTexture.flipY puts ImageData row 0 (image top) on plane +Y.
 *   Ax  (flipH false): top = A → +Y, right = L → +X
 *   Cor (flipH true):  top = S → +Z, right = L → +X
 *   Sag (flipH true):  top = S → +Z, right = P → −Y
 */
export function sliceCapBasis(axis: Axis): SliceCapBasis {
  if (axis === 'axial') {
    return { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
  }
  if (axis === 'coronal') {
    // Right-handed: +X × +Z = −Y. Front faces Posterior; we view from +Y (the
    // discarded side) so L-R is not mirrored. Offset still goes toward +Y.
    return { x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] }
  }
  return { x: [0, -1, 0], y: [0, 0, 1], z: [-1, 0, 0] }
}

function axisExtent(volume: Volume, axis: Axis): number {
  if (axis === 'axial') return volume.slices * volume.spacing[2]
  if (axis === 'coronal') return volume.rows * volume.spacing[1]
  return volume.cols * volume.spacing[0]
}

import type { Axis, MaskOverlay, Volume } from '../types'
import { cutLabelPlane, dimExtent, planeGeometry, planeToVoxel, type Dim } from './slice'

export function axisToDim(axis: Axis): Dim {
  return axis === 'axial' ? 'z' : axis === 'coronal' ? 'y' : 'x'
}

export function dimToAxis(dim: Dim): Axis {
  return dim === 'z' ? 'axial' : dim === 'y' ? 'coronal' : 'sagittal'
}

/** Number of cuts available along `axis`. */
export function sliceCount(volume: Volume, axis: Axis): number {
  return dimExtent([volume.cols, volume.rows, volume.slices], axisToDim(axis))
}

/**
 * Pixel size of a cut plus its physical aspect ratio. The aspect is what keeps
 * anisotropic series from looking squashed — MR slice spacing is routinely 5–10×
 * the in-plane spacing, so drawing a coronal cut at pixel aspect would stretch
 * it badly.
 */
export function planeSize(volume: Volume, axis: Axis): { width: number; height: number; aspect: number } {
  const dims: [number, number, number] = [volume.cols, volume.rows, volume.slices]
  const dim = axisToDim(axis)
  const { width, height } = planeGeometry(dims, dim)
  const [sx, sy, sz] = volume.spacing

  const physical: Record<Dim, [number, number]> = {
    z: [volume.cols * sx, volume.rows * sy],
    y: [volume.cols * sx, volume.slices * sz],
    x: [volume.rows * sy, volume.slices * sz],
  }
  const [pw, ph] = physical[dim]

  return { width, height, aspect: pw / Math.max(1e-6, ph) }
}

/** Standard radiological edge labels, in `[left, right, top, bottom]` order. */
export const ORIENT_LABELS: Record<Axis, [string, string, string, string]> = {
  axial: ['R', 'L', 'A', 'P'],
  coronal: ['R', 'L', 'S', 'I'],
  sagittal: ['A', 'P', 'S', 'I'],
}

/**
 * Resolve every visible overlay to a label plane matching the cut's display
 * geometry, so `compositeMask` can blend them straight onto the ImageData.
 *
 * Masks whose dimensions differ from the volume's are nearest-neighbour sampled
 * rather than rejected: half-resolution segmentation output is common enough
 * that refusing it would be the wrong call.
 */
export function overlayPlanes(
  overlays: MaskOverlay[] | undefined,
  volume: Volume,
  axis: Axis,
  index: number,
): Array<{ overlay: MaskOverlay; plane: Uint8Array | Uint16Array }> {
  if (!overlays?.length) return []

  const dims: [number, number, number] = [volume.cols, volume.rows, volume.slices]
  const dim = axisToDim(axis)
  const result: Array<{ overlay: MaskOverlay; plane: Uint8Array | Uint16Array }> = []

  for (const overlay of overlays) {
    if (overlay.visible === false) continue

    if (!overlay.dims) {
      // Single-slice mask: only meaningful on the axial cut it was drawn on.
      if (dim !== 'z') continue
      if ((overlay.sliceIndex ?? 0) !== Math.round(index)) continue
      if (overlay.labels.length < volume.cols * volume.rows) continue
      result.push({ overlay, plane: overlay.labels })
      continue
    }

    const src = overlay.dims
    if (src[0] === dims[0] && src[1] === dims[1] && src[2] === dims[2]) {
      result.push({ overlay, plane: cutLabelPlane(overlay.labels, dims, dim, index) })
      continue
    }

    const resampled = resampleLabelPlane(overlay.labels, src, dims, dim, index)
    if (resampled) result.push({ overlay, plane: resampled })
  }

  return result
}

/** Nearest-neighbour sample a differently sized labelmap onto the volume's cut. */
function resampleLabelPlane(
  labels: Uint8Array | Uint16Array,
  src: [number, number, number],
  dims: [number, number, number],
  dim: Dim,
  index: number,
): Uint16Array | null {
  if (labels.length < src[0] * src[1] * src[2]) return null

  const { width, height } = planeGeometry(dims, dim)
  const out = new Uint16Array(width * height)
  const ratio: [number, number, number] = [src[0] / dims[0], src[1] / dims[1], src[2] / dims[2]]
  const srcStride = src[0] * src[1]

  for (let h = 0; h < height; h++) {
    for (let w = 0; w < width; w++) {
      const [vx, vy, vz] = planeToVoxel(dims, dim, index, w, h)
      const sx = Math.min(src[0] - 1, (vx * ratio[0]) | 0)
      const sy = Math.min(src[1] - 1, (vy * ratio[1]) | 0)
      const sz = Math.min(src[2] - 1, (vz * ratio[2]) | 0)
      out[h * width + w] = labels[sx + sy * src[0] + sz * srcStride]
    }
  }
  return out
}

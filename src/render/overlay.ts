import type { MaskOverlay } from '../types'
import { cutLabelPlane, type Dim } from './slice'

/**
 * Palette for labels that the host did not assign a colour to. Ordered so that
 * adjacent label ids stay distinguishable, which matters for segmentation output
 * where neighbouring structures usually get consecutive ids.
 */
export const DEFAULT_COLORMAP: Record<number, string> = {
  1: '#ef4444',
  2: '#3b82f6',
  3: '#22c55e',
  4: '#eab308',
  5: '#a855f7',
  6: '#06b6d4',
  7: '#f97316',
  8: '#ec4899',
  9: '#84cc16',
  10: '#14b8a6',
  11: '#8b5cf6',
  12: '#f59e0b',
}

const PALETTE = Object.values(DEFAULT_COLORMAP)
export const DEFAULT_OPACITY = 0.45

const packedMaskCache = new Map<string, Uint8Array>()

/** CSS colour the GPU uses when the host did not put `label` in `colormap`. */
export function defaultLabelColor(label: number): string {
  if (label <= 0) return PALETTE[0]
  return PALETTE[(label - 1) % PALETTE.length]
}

const colorCache = new Map<string, [number, number, number]>()

export function parseColor(input: string): [number, number, number] {
  const cached = colorCache.get(input)
  if (cached) return cached

  const parsed = parseColorUncached(input)
  colorCache.set(input, parsed)
  return parsed
}

function parseColorUncached(input: string): [number, number, number] {
  const value = input.trim()

  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ]
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ]
    }
  }

  const fn = value.match(/rgba?\(([^)]+)\)/i)
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean).map(Number)
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0], parts[1], parts[2]]
    }
  }

  return [255, 0, 0]
}

/** Resolve a label id to RGB, falling back to the cycling default palette. */
function labelColor(overlay: MaskOverlay, label: number): [number, number, number] {
  const explicit = overlay.colormap?.[label]
  if (explicit) return parseColor(explicit)
  return parseColor(defaultLabelColor(label))
}

/**
 * Alpha-blend label planes onto a grayscale `ImageData` in place.
 *
 * Colours are resolved into a small per-overlay table first: a labelmap has far
 * more voxels than distinct labels, so doing the string parsing per pixel would
 * dominate the cost of a redraw.
 */
export function compositeMask(
  image: ImageData,
  overlays: Array<{ overlay: MaskOverlay; plane: Uint8Array | Uint16Array }>,
): void {
  if (!overlays.length) return
  const pixels = image.data
  const count = image.width * image.height

  for (const { overlay, plane } of overlays) {
    if (overlay.visible === false) continue
    const alpha = Math.max(0, Math.min(1, overlay.opacity ?? DEFAULT_OPACITY))
    if (alpha === 0) continue

    const table = new Map<number, [number, number, number]>()
    const limit = Math.min(count, plane.length)

    for (let i = 0; i < limit; i++) {
      const label = plane[i]
      if (label === 0) continue

      let rgb = table.get(label)
      if (!rgb) {
        rgb = labelColor(overlay, label)
        table.set(label, rgb)
      }

      const o = i * 4
      // Source-over so a label on transparent air still writes alpha. When
      // the destination is already opaque this is the same RGB lerp as before.
      const dstA = pixels[o + 3] / 255
      const outA = alpha + dstA * (1 - alpha)
      if (outA <= 0) continue
      const srcW = alpha / outA
      const dstW = (dstA * (1 - alpha)) / outA
      pixels[o] = rgb[0] * srcW + pixels[o] * dstW
      pixels[o + 1] = rgb[1] * srcW + pixels[o + 1] * dstW
      pixels[o + 2] = rgb[2] * srcW + pixels[o + 2] * dstW
      pixels[o + 3] = outA * 255
    }
  }
}

/** Sample a 3D labelmap onto an orthogonal plane, using the same geometry as the image. */
export function sampleLabelPlane(
  labels: Uint8Array | Uint16Array,
  dims: [number, number, number],
  axis: Dim,
  index: number,
): Uint16Array {
  return cutLabelPlane(labels, dims, axis, index)
}

/**
 * Pack overlays into an `R³` RGBA texture for the GPU ray marcher.
 *
 * Nearest-neighbour on purpose: interpolating label ids would invent labels that
 * do not exist between two structures. Alpha carries the overlay opacity so the
 * shader can blend without knowing anything about the overlay model.
 */
export function overlaysToRgbaVolume(overlays: MaskOverlay[], resolution: number): Uint8Array {
  const R = resolution
  const out = new Uint8Array(R * R * R * 4)

  for (const overlay of overlays) {
    if (overlay.visible === false) continue
    if (!overlay.dims) continue

    const alpha = Math.round(Math.max(0, Math.min(1, overlay.opacity ?? DEFAULT_OPACITY)) * 255)
    if (alpha === 0) continue

    const [sc, sr, ss] = overlay.dims
    if (overlay.labels.length < sc * sr * ss) continue

    // Cube index → overlay index. The volume's own dimensions cancel out of this
    // ratio, and the `-1` terms match `resampleToCube`, which maps the *last*
    // cube sample onto the last voxel. A plain size ratio would drift the mask
    // against the greyscale by up to a voxel at the far edge.
    const rx = (sc - 1) / Math.max(1, R - 1)
    const ry = (sr - 1) / Math.max(1, R - 1)
    const rz = (ss - 1) / Math.max(1, R - 1)
    const srcStride = sc * sr
    const table = new Map<number, [number, number, number]>()

    for (let k = 0; k < R; k++) {
      const sz = Math.min(ss - 1, (k * rz) | 0)
      for (let j = 0; j < R; j++) {
        const sy = Math.min(sr - 1, (j * ry) | 0)
        const rowBase = (k * R * R + j * R) * 4
        const srcRow = sy * sc + sz * srcStride
        for (let i = 0; i < R; i++) {
          const label = overlay.labels[Math.min(sc - 1, (i * rx) | 0) + srcRow]
          if (label === 0) continue

          let rgb = table.get(label)
          if (!rgb) {
            rgb = labelColor(overlay, label)
            table.set(label, rgb)
          }

          const o = rowBase + i * 4
          out[o] = rgb[0]
          out[o + 1] = rgb[1]
          out[o + 2] = rgb[2]
          out[o + 3] = alpha
        }
      }
    }
  }

  return out
}

/**
 * Identity of the 3D label volume. Visibility and opacity are excluded so a
 * hide / fade can reuse the last packed cube instead of resampling 96³.
 */
export function maskVolumeContentKey(
  overlays: MaskOverlay[] | undefined,
  resolution: number,
): string {
  const volumetric = overlays?.filter((overlay) => overlay.dims) ?? []
  if (!volumetric.length) return `empty:${resolution}`
  return `${resolution}:${volumetric
    .map((overlay) => {
      const dims = overlay.dims?.join('x') ?? ''
      return `${overlay.id}:${overlay.labels.byteLength}:${dims}:${JSON.stringify(overlay.colormap ?? '')}`
    })
    .join('|')}`
}

/**
 * Pack overlays into a cached occupancy cube (alpha = 255). Visibility and
 * host opacity are ignored — the ray marcher applies those as uniforms.
 */
export function packedMaskVolume(
  overlays: MaskOverlay[] | undefined,
  resolution: number,
): Uint8Array | null {
  const key = maskVolumeContentKey(overlays, resolution)
  if (key.startsWith('empty:')) return null
  const cached = packedMaskCache.get(key)
  if (cached) return cached

  const packed = overlaysToRgbaVolume(
    (overlays ?? [])
      .filter((overlay) => overlay.dims)
      .map((overlay) => ({ ...overlay, visible: true, opacity: 1 })),
    resolution,
  )
  packedMaskCache.set(key, packed)
  return packed
}

/** Viewer-level hide / fade derived from the overlays the host already passed. */
export function maskVolumePresentation(overlays: MaskOverlay[] | undefined): {
  active: boolean
  opacity: number
} {
  const volumetric = overlays?.filter((overlay) => overlay.dims) ?? []
  const visible = volumetric.filter((overlay) => overlay.visible !== false)
  const source = visible[0] ?? volumetric[0]
  return {
    active: visible.length > 0,
    opacity: Math.max(0, Math.min(1, source?.opacity ?? DEFAULT_OPACITY)),
  }
}

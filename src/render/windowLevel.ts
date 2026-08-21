/**
 * Window/level mapping from stored intensities to 8-bit gray.
 *
 * This runs on every pixel of every redraw, so the gamma curve and the
 * inversion are folded into a 256-entry lookup table built once per call rather
 * than evaluated per pixel.
 */

const GRAY_LEVELS = 256

function buildToneCurve(gamma: number, invert: boolean): Uint8ClampedArray {
  const curve = new Uint8ClampedArray(GRAY_LEVELS)
  const linear = gamma === 1 || gamma <= 0
  for (let i = 0; i < GRAY_LEVELS; i++) {
    const v = linear ? i : 255 * Math.pow(i / 255, 1 / gamma)
    curve[i] = invert ? 255 - v : v
  }
  return curve
}

/**
 * Map `raw` through the window and return an RGBA `ImageData` of `cols × rows`.
 *
 * Alpha is opaque by default so 2D canvases keep a solid backdrop. Pass
 * `transparentBackground` for the 3D clip cap: below-window (air) voxels
 * ramp to alpha 0 from the *windowed* intensity, before invert/gamma, so
 * inversion cannot turn empty FOV into an opaque white card.
 */
export function applyWindowLevel(
  raw: Float32Array,
  rows: number,
  cols: number,
  wc: number,
  ww: number,
  gamma = 1,
  invert = false,
  transparentBackground = false,
): ImageData {
  const image = new ImageData(cols, rows)
  const out = image.data
  const curve = buildToneCurve(gamma, invert)

  const width = ww || 1
  const low = wc - width / 2
  const scale = 255 / width

  const count = Math.min(raw.length, cols * rows)
  for (let i = 0; i < count; i++) {
    let g = (raw[i] - low) * scale
    g = g < 0 ? 0 : g > 255 ? 255 : g
    const gray = curve[g | 0]
    const o = i * 4
    out[o] = gray
    out[o + 1] = gray
    out[o + 2] = gray
    out[o + 3] = transparentBackground ? (g + 0.5) | 0 : 255
  }
  return image
}

/** Single-value form of {@link applyWindowLevel}, for probes and tooltips. */
export function windowToGray(value: number, wc: number, ww: number, gamma = 1, invert = false): number {
  const width = ww || 1
  let g = ((value - (wc - width / 2)) / width) * 255
  g = g < 0 ? 0 : g > 255 ? 255 : g
  if (gamma !== 1 && gamma > 0) g = 255 * Math.pow(g / 255, 1 / gamma)
  return Math.round(invert ? 255 - g : g)
}

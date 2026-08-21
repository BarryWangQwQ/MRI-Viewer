import type { Axis, DisplayParams, MaskOverlay, Volume } from '../types'
import { extractAxial, extractCoronal, extractSagittal } from './slice'
import { overlayPlanes, planeSize } from './planes'
import { compositeMask } from './overlay'
import { applyWindowLevel } from './windowLevel'

export interface PaintSliceOptions {
  /**
   * 3D clip-cap only. Air / below-window voxels become transparent so the
   * cut face does not draw an opaque black rectangle. 2D callers omit this
   * and keep a solid backdrop.
   */
  transparentBackground?: boolean
}

/**
 * Paint one orthogonal cut — windowed grayscale plus every visible mask — into
 * an `ImageData`. Shared by the 2D canvas and the 3D clip-face texture so the
 * two can never drift apart.
 */
export function paintSlice(
  volume: Volume,
  axis: Axis,
  index: number,
  display: DisplayParams,
  overlays?: MaskOverlay[],
  options?: PaintSliceOptions,
): ImageData {
  const plane =
    axis === 'axial'
      ? extractAxial(volume, index)
      : axis === 'coronal'
        ? extractCoronal(volume, index)
        : extractSagittal(volume, index)

  const geometry = planeSize(volume, axis)
  const image = applyWindowLevel(
    plane,
    geometry.height,
    geometry.width,
    display.windowCenter,
    display.windowWidth,
    display.gamma,
    display.invert,
    options?.transparentBackground === true,
  )
  compositeMask(image, overlayPlanes(overlays, volume, axis, index))
  return image
}

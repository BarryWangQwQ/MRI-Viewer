import type { CSSProperties } from 'react'

export type Layout = 'slice' | 'mpr' | 'volume'

export type Axis = 'axial' | 'coronal' | 'sagittal'

export interface DisplayParams {
  windowCenter: number
  windowWidth: number
  /** 1 is linear. Applied after windowing, on the 0–255 gray value. */
  gamma: number
  invert: boolean
}

/**
 * A resampled, axis-aligned scalar volume.
 *
 * Voxels are indexed `x + y * cols + z * cols * rows`, and the loaders
 * reorient every input into one canonical anatomical convention so that no
 * downstream code has to look at an affine again:
 *
 *   +x → patient Left, +y → patient Posterior, +z → patient Superior
 *
 * That is the LPS ordering a plain axial DICOM series already arrives in, which
 * makes the common case a no-op. `affine` is kept for callers that need to map
 * back to world coordinates, and describes the volume *after* reorientation.
 */
export interface Volume {
  cols: number
  rows: number
  slices: number
  data: Float32Array
  /** Millimetres per voxel along x, y, z. */
  spacing: [number, number, number]
  /** Voxel → world (mm), row-major 4×4. */
  affine?: number[][]
  windowCenter: number
  windowWidth: number
  min: number
  max: number
  modality?: string
  description?: string
}

export type LabelArray = Uint8Array | Uint16Array

/**
 * A label mask drawn over the image. Masks are read-only as far as the viewer
 * is concerned — it renders whatever the host passes and never edits it.
 */
export interface MaskOverlay {
  id: string
  /**
   * Integer labels, where 0 is background and renders as fully transparent.
   * Length is `cols * rows * slices` for a volume-wide labelmap, or
   * `cols * rows` for a mask that covers only `sliceIndex`.
   */
  labels: LabelArray
  /** Required for a 3D labelmap; omit for a single-slice mask. */
  dims?: [number, number, number]
  /** Axial slice a 2D mask belongs to. Ignored when `dims` is set. */
  sliceIndex?: number
  /** Label id → CSS colour (`#rgb`, `#rrggbb` or `rgb()`). Falls back to the built-in palette. */
  colormap?: Record<number, string>
  /** Label id → region name. Chrome uses this for legend hover text. */
  names?: Record<number, string>
  /** 0–1, default 0.45. */
  opacity?: number
  visible?: boolean
}

/** Voxel coordinate the MPR crosshairs are locked to. */
export interface VoxelCursor {
  x: number
  y: number
  z: number
}

/**
 * Path or local file(s) for {@link MedicalViewerProps.src}.
 *
 * - `string` — `http(s)://` or a same-origin / relative URL (`/foo.nii.gz`). Fetched as NIfTI.
 * - `File` / `File[]` / `FileList` — same as {@link MedicalViewerProps.files} (NIfTI or DICOM).
 *
 * Browsers block `file://`; pass a `File` from `<input type="file">` instead.
 */
export type MedicalViewerSrc = string | File | File[] | FileList

export interface MedicalViewerProps {
  /** DICOM series (one file per slice), or a single `.nii` / `.nii.gz`. */
  files?: File[] | FileList | null
  /**
   * Pre-built volume, for hosts that do their own decoding.
   * Precedence: `volume` > `files` > `src`.
   */
  volume?: Volume | null
  /**
   * URL or local `File`(s). Remote / same-origin strings are fetched as NIfTI;
   * `File` objects take the same path as `files`. Ignored if `volume` or `files` is set.
   */
  src?: MedicalViewerSrc

  layout?: Layout
  onLayoutChange?: (layout: Layout) => void

  /** Slice along the currently displayed axis. Uncontrolled when omitted. */
  sliceIndex?: number
  onSliceChange?: (index: number) => void

  display?: Partial<DisplayParams>
  onDisplayChange?: (display: DisplayParams) => void

  overlays?: MaskOverlay[]

  cursor?: VoxelCursor
  onCursorChange?: (cursor: VoxelCursor) => void

  onLoad?: (volume: Volume) => void
  onError?: (error: Error) => void

  theme?: 'dark' | 'light'
  className?: string
  style?: CSSProperties

  /**
   * Built-in toolbar and side panel. Set to `false` to render nothing but the
   * image and drive everything through props.
   */
  chrome?: boolean

  /** `gpu` ray-marches an isosurface in a shader; `mesh` runs marching cubes. */
  volumeMode?: 'gpu' | 'mesh'
  /** Isosurface level, normalised to 0–1 across the volume's intensity range. */
  isoThreshold?: number

  /** Cine playback of the current plane. Uncontrolled when omitted. */
  playing?: boolean
  onPlayingChange?: (playing: boolean) => void
  /** Milliseconds between frames while playing. Default 80 (~12 fps). */
  playIntervalMs?: number

  /**
   * Cut the 3D volume open at the current slice and paint that face, so
   * interior masks are visible. Defaults to on whenever a volume is showing.
   */
  clipEnabled?: boolean
  onClipEnabledChange?: (enabled: boolean) => void
}

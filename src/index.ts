import './styles.css'

/* ── Drop-in component ────────────────────────────────────────────────────── */
export { MedicalViewer } from './MedicalViewer'
export { MedicalViewer as MriViewer } from './MedicalViewer'

/* ── Composable views, for hosts building their own layout ────────────────── */
export { SliceCanvas, AXIS_COLOR, type SliceCanvasProps } from './views/SliceCanvas'
export { MultiAxisView, type MultiAxisViewProps } from './views/MultiAxisView'
export { VolumeView, type VolumeViewProps } from './views/VolumeView'

/* ── Loading ──────────────────────────────────────────────────────────────── */
export { loadVolume, createDemoVolume, createDemoMask } from './load/volume'
export { loadDicomVolume, parseDicomSlice, isDicomFilename, type DicomSlice } from './load/dicom'
export { loadNiftiVolume, loadNiftiFromUrl, parseNiftiVolume, isNiftiFilename } from './load/nifti'
export { canonicalizeToLps, rasToLps, type OrientedVolume, type Vec3 } from './load/orient'

/* ── Rendering primitives ─────────────────────────────────────────────────── */
export { applyWindowLevel, windowToGray } from './render/windowLevel'
export {
  extractAxial,
  extractCoronal,
  extractSagittal,
  resampleToCube,
  voxelIndex,
  planeGeometry,
  planeToVoxel,
  voxelToPlane,
  dimExtent,
  type Dim,
} from './render/slice'
export {
  axisToDim,
  dimToAxis,
  sliceCount,
  planeSize,
  overlayPlanes,
  ORIENT_LABELS,
} from './render/planes'
export { paintSlice, type PaintSliceOptions } from './render/paintSlice'
export {
  sliceWorldPosition,
  sliceClipPlane,
  sliceCapPose,
  sliceCapBasis,
} from './render/clip'
export type { SliceClipPlane, SliceCapPose, SliceCapBasis } from './render/clip'
export {
  DEFAULT_COLORMAP,
  defaultLabelColor,
  compositeMask,
  parseColor,
  sampleLabelPlane,
  overlaysToRgbaVolume,
} from './render/overlay'

/* ── three.js building blocks ─────────────────────────────────────────────── */
export { VolumeRayMarcher } from './three/volumeRayMarcher'
export { buildIsoMesh, type IsoMesh } from './three/meshBuilder'

/* ── Types ────────────────────────────────────────────────────────────────── */
export type {
  Axis,
  DisplayParams,
  LabelArray,
  Layout,
  MaskOverlay,
  MedicalViewerProps,
  MedicalViewerSrc,
  Volume,
  VoxelCursor,
} from './types'
export type { MedicalViewerProps as MriViewerProps } from './types'

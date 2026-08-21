import * as nifti from 'nifti-reader-js'
import type { Volume } from '../types'
import { canonicalizeToLps, rasToLps, type Vec3 } from './orient'

export function isNiftiFilename(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.nii') || lower.endsWith('.nii.gz') || lower.endsWith('.hdr') || lower.endsWith('.img')
}

/** NIfTI datatype codes, mapped to the typed array that views the raw bytes. */
const DECODERS: Record<number, (buffer: ArrayBuffer, offset: number, length: number) => ArrayLike<number>> = {
  2: (b, o, n) => new Uint8Array(b, o, n),
  4: (b, o, n) => new Int16Array(b, o, n),
  8: (b, o, n) => new Int32Array(b, o, n),
  16: (b, o, n) => new Float32Array(b, o, n),
  64: (b, o, n) => new Float64Array(b, o, n),
  256: (b, o, n) => new Int8Array(b, o, n),
  512: (b, o, n) => new Uint16Array(b, o, n),
  768: (b, o, n) => new Uint32Array(b, o, n),
}

const BYTES_PER_VOXEL: Record<number, number> = {
  2: 1,
  4: 2,
  8: 4,
  16: 4,
  64: 8,
  256: 1,
  512: 2,
  768: 4,
}

/** Normalise a column of the affine's rotation part into a unit direction. */
function column(affine: number[][], index: number): Vec3 {
  const v: Vec3 = [affine[0][index], affine[1][index], affine[2][index]]
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

/**
 * Decode a NIfTI buffer into a canonical volume.
 *
 * For 4D series only the requested `timepoint` is materialised. Loading every
 * volume of a functional or diffusion series would multiply memory by the number
 * of timepoints for no benefit — the viewer shows one at a time.
 */
export function parseNiftiVolume(buffer: ArrayBuffer, timepoint = 0): Volume | null {
  let data: ArrayBuffer = buffer
  if (nifti.isCompressed(data)) {
    data = nifti.decompress(data) as ArrayBuffer
  }
  if (!nifti.isNIFTI(data)) return null

  const header = nifti.readHeader(data)
  if (!header) return null

  const [, nx, ny, nz] = header.dims
  const nt = header.dims[0] >= 4 ? header.dims[4] || 1 : 1
  if (!nx || !ny || !nz) return null

  const bytesPerVoxel = BYTES_PER_VOXEL[header.datatypeCode]
  const decode = DECODERS[header.datatypeCode]
  if (!bytesPerVoxel || !decode) {
    throw new Error(`Unsupported NIfTI datatype code ${header.datatypeCode}.`)
  }

  const image = nifti.readImage(header, data)
  const perVolume = nx * ny * nz
  const frame = Math.max(0, Math.min(nt - 1, Math.round(timepoint)))
  const byteOffset = frame * perVolume * bytesPerVoxel
  if (byteOffset + perVolume * bytesPerVoxel > image.byteLength) return null

  const source = decode(image, byteOffset, perVolume)

  // scl_slope of 0 means "no scaling" per the spec, not "scale everything to 0".
  const slope = header.scl_slope === 0 ? 1 : header.scl_slope || 1
  const intercept = header.scl_inter || 0

  const voxels = new Float32Array(perVolume)
  for (let i = 0; i < perVolume; i++) voxels[i] = source[i] * slope + intercept

  // Window/level has to stay fixed across timepoints, otherwise scrubbing a 4D
  // series makes the brightness jump on every frame. Both extremes therefore
  // come from the whole series, not just the frame being shown.
  let min = Infinity
  let max = -Infinity
  const totalVoxels = Math.min(nt * perVolume, Math.floor(image.byteLength / bytesPerVoxel))
  const all = decode(image, 0, totalVoxels)
  for (let i = 0; i < totalVoxels; i++) {
    const v = all[i] * slope + intercept
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = 0
    max = 1
  }

  const pixDims = header.pixDims ?? []
  const spacing: [number, number, number] = [
    Math.abs(pixDims[1]) || 1,
    Math.abs(pixDims[2]) || 1,
    Math.abs(pixDims[3]) || 1,
  ]

  const affine = (header.affine as number[][] | undefined) ?? null
  const dirs: [Vec3, Vec3, Vec3] = affine
    ? [rasToLps(column(affine, 0)), rasToLps(column(affine, 1)), rasToLps(column(affine, 2))]
    : // Without an affine, assume the common RAS storage order.
      [rasToLps([1, 0, 0]), rasToLps([0, 1, 0]), rasToLps([0, 0, 1])]
  const origin: Vec3 | undefined = affine
    ? [-affine[0][3], -affine[1][3], affine[2][3]]
    : undefined

  const oriented = canonicalizeToLps(voxels, [nx, ny, nz], spacing, dirs, origin)

  const calMin = header.cal_min ?? 0
  const calMax = header.cal_max ?? 0
  const useCal = calMax > calMin
  const windowWidth = useCal ? calMax - calMin : max - min
  const windowCenter = useCal ? (calMin + calMax) / 2 : (min + max) / 2

  return {
    cols: oriented.dims[0],
    rows: oriented.dims[1],
    slices: oriented.dims[2],
    data: oriented.data,
    spacing: oriented.spacing,
    affine: oriented.affine,
    windowCenter,
    windowWidth: windowWidth || 1,
    min,
    max,
    modality: 'MR',
    description: header.description?.trim() || undefined,
  }
}

export async function loadNiftiVolume(source: File | ArrayBuffer, timepoint = 0): Promise<Volume | null> {
  const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer()
  return parseNiftiVolume(buffer, timepoint)
}

function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url, 'http://local.invalid').pathname
    const segment = path.split('/').pop() ?? path
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  } catch {
    return url.split('?')[0]?.split('#')[0] ?? url
  }
}

function isZipUrl(url: string): boolean {
  return filenameFromUrl(url).toLowerCase().endsWith('.zip')
}

/**
 * Fetch a single NIfTI from `url` and decode it.
 *
 * Accepts `http(s)://` and same-origin / relative paths (`/foo.nii.gz`).
 * `file://` is rejected — browsers block it; pass a `File` via `src` instead.
 * A `.zip` is rejected without a network request. DICOM directories are not
 * fetched from one URL — only `.nii` / `.nii.gz` (or a buffer that parses as
 * NIfTI) is accepted.
 */
export async function loadNiftiFromUrl(url: string, timepoint = 0): Promise<Volume> {
  const trimmed = url.trim()
  if (!trimmed) throw new Error('No URL was provided.')
  if (/^file:/i.test(trimmed)) {
    throw new Error(
      'file:// URLs cannot be loaded in the browser. Pass an http(s) or same-origin URL, or a File from <input type="file"> via src.',
    )
  }
  if (isZipUrl(trimmed)) {
    throw new Error('ZIP archives are not supported. Provide a direct .nii or .nii.gz URL.')
  }

  let response: Response
  try {
    response = await fetch(trimmed)
  } catch (cause) {
    throw new Error(
      `Could not fetch ${trimmed}. The file may be unreachable, or the server may be blocking cross-origin requests (CORS).`,
      { cause: cause instanceof Error ? cause : undefined },
    )
  }

  if (!response.ok) {
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    throw new Error(`Could not fetch ${trimmed}: the server returned ${status}.`)
  }

  const volume = parseNiftiVolume(await response.arrayBuffer(), timepoint)
  if (!volume) {
    throw new Error(`${trimmed} is not a readable NIfTI volume (.nii / .nii.gz).`)
  }
  return volume
}

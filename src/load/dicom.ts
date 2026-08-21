import * as dicomParser from 'dicom-parser'
import type { Volume } from '../types'
import { canonicalizeToLps, type Vec3 } from './orient'

/**
 * Transfer syntaxes whose pixel data is stored as plain samples. `dicom-parser`
 * reads the data set of any syntax, but it does not decode compressed pixel
 * streams, so anything outside this set has to be reported rather than silently
 * rendered as noise.
 */
const UNCOMPRESSED_SYNTAXES = new Set([
  '1.2.840.10008.1.2', // implicit VR little endian
  '1.2.840.10008.1.2.1', // explicit VR little endian
  '1.2.840.10008.1.2.2', // explicit VR big endian
])

const BIG_ENDIAN_SYNTAX = '1.2.840.10008.1.2.2'

export interface DicomSlice {
  raw: Float32Array
  rows: number
  cols: number
  instanceNumber?: number
  /** Projection of ImagePositionPatient onto the slice normal, when available. */
  z?: number | null
  /** `[rowSpacing, colSpacing]` in mm, as stored in the file. */
  spacing: [number, number]
  thickness: number
  windowCenter?: number
  windowWidth?: number
  modality?: string
  description?: string
  /** Raw ImageOrientationPatient, six backslash-separated direction cosines. */
  orientation?: string
  /** Frames stacked in this one file, for enhanced multi-frame objects. */
  frames?: number
  position?: Vec3
}

export function isDicomFilename(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower === 'dicomdir') return false
  return lower.endsWith('.dcm') || lower.endsWith('.dicom') || lower.endsWith('.ima') || !lower.includes('.')
}

function parseNumbers(value: string | undefined): number[] {
  if (!value) return []
  return value
    .split('\\')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n))
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * Decode one DICOM file's pixel data into rescaled floating point intensities.
 *
 * Returns `null` when the file is not DICOM at all; throws when it is DICOM but
 * cannot be decoded, because those two cases need very different handling
 * upstream — one is a stray file in a folder, the other is a real problem the
 * user should hear about.
 */
export async function parseDicomSlice(file: File): Promise<DicomSlice | null> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  let dataSet: dicomParser.DataSet
  try {
    dataSet = dicomParser.parseDicom(bytes)
  } catch {
    return null
  }

  const rows = dataSet.uint16('x00280010') ?? 0
  const cols = dataSet.uint16('x00280011') ?? 0
  if (!rows || !cols) return null

  const pixelElement = dataSet.elements.x7fe00010
  if (!pixelElement) return null

  const syntax = dataSet.string('x00020010')?.trim()
  if (syntax && !UNCOMPRESSED_SYNTAXES.has(syntax)) {
    throw new Error(
      `${file.name}: compressed DICOM (transfer syntax ${syntax}) is not supported. ` +
        'Decompress the series, or decode it yourself and pass a `volume` prop.',
    )
  }
  const littleEndian = syntax !== BIG_ENDIAN_SYNTAX

  const bitsAllocated = dataSet.uint16('x00280100') ?? 16
  const pixelRepresentation = dataSet.uint16('x00280103') ?? 0
  const samplesPerPixel = dataSet.uint16('x00280002') ?? 1
  if (samplesPerPixel !== 1) {
    throw new Error(`${file.name}: colour DICOM (${samplesPerPixel} samples per pixel) is not supported.`)
  }

  const slope = dataSet.floatString('x00281053') || 1
  const intercept = dataSet.floatString('x00281052') || 0
  const frames = Number(dataSet.intString('x00280008')) || 1

  const perFrame = rows * cols
  const total = perFrame * frames
  const bytesPerSample = bitsAllocated === 8 ? 1 : 2
  const available = Math.floor(pixelElement.length / bytesPerSample)
  const count = Math.min(total, available)

  const view = new DataView(buffer, pixelElement.dataOffset, pixelElement.length)
  const raw = new Float32Array(count)

  if (bitsAllocated === 16) {
    for (let i = 0; i < count; i++) {
      const value =
        pixelRepresentation === 1
          ? view.getInt16(i * 2, littleEndian)
          : view.getUint16(i * 2, littleEndian)
      raw[i] = value * slope + intercept
    }
  } else if (bitsAllocated === 8) {
    for (let i = 0; i < count; i++) {
      raw[i] = view.getUint8(i) * slope + intercept
    }
  } else {
    throw new Error(`${file.name}: unsupported bit depth (${bitsAllocated} bits allocated).`)
  }

  const pixelSpacing = parseNumbers(dataSet.string('x00280030')?.trim())
  const position = parseNumbers(dataSet.string('x00200032')?.trim())
  const orientation = dataSet.string('x00200037')?.trim()

  return {
    raw,
    rows,
    cols,
    instanceNumber: dataSet.intString('x00200013') || undefined,
    spacing: [pixelSpacing[0] || 1, pixelSpacing[1] || pixelSpacing[0] || 1],
    thickness:
      dataSet.floatString('x00180050') ||
      dataSet.floatString('x00180088') /* SpacingBetweenSlices */ ||
      1,
    windowCenter: dataSet.floatString('x00281050') || undefined,
    windowWidth: dataSet.floatString('x00281051') || undefined,
    modality: dataSet.string('x00080060')?.trim(),
    description: dataSet.string('x0008103e')?.trim() || dataSet.string('x00081030')?.trim(),
    orientation,
    frames: frames > 1 ? frames : undefined,
    position: position.length === 3 ? (position as Vec3) : undefined,
    z: null,
  }
}

/** Bounded-concurrency map, to avoid opening hundreds of file handles at once. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Stack a DICOM series into a canonical volume.
 *
 * Slice ordering uses the projection of ImagePositionPatient onto the slice
 * normal when the geometry is present, and InstanceNumber otherwise. The former
 * matters because InstanceNumber ordering does not always run monotonically
 * through space, and a mis-ordered stack produces a subtly wrong reconstruction
 * rather than an obvious error.
 */
export async function loadDicomVolume(files: File[]): Promise<Volume | null> {
  if (!files.length) return null

  const parsed = (await mapPool(files, 6, async (file) => {
    try {
      return await parseDicomSlice(file)
    } catch (error) {
      // A single unreadable file should not sink the series, but a series where
      // every file is compressed has to surface the reason.
      return error instanceof Error ? error : null
    }
  })) as Array<DicomSlice | Error | null>

  const slices = parsed.filter((entry): entry is DicomSlice => !!entry && !(entry instanceof Error))
  if (!slices.length) {
    const firstError = parsed.find((entry): entry is Error => entry instanceof Error)
    if (firstError) throw firstError
    return null
  }

  // Keep the largest set of same-sized slices; mixed geometry means mixed series.
  const groups = new Map<string, DicomSlice[]>()
  for (const slice of slices) {
    const key = `${slice.cols}x${slice.rows}`
    const group = groups.get(key)
    if (group) group.push(slice)
    else groups.set(key, [slice])
  }
  const series = [...groups.values()].sort((a, b) => b.length - a.length)[0]

  const reference = series[0]
  const cosines = parseNumbers(reference.orientation)
  const hasOrientation = cosines.length === 6
  const rowDir: Vec3 = hasOrientation ? [cosines[0], cosines[1], cosines[2]] : [1, 0, 0]
  const colDir: Vec3 = hasOrientation ? [cosines[3], cosines[4], cosines[5]] : [0, 1, 0]
  const normal = cross(rowDir, colDir)

  const multiFrame = series.length === 1 && (reference.frames ?? 1) > 1

  for (const slice of series) {
    slice.z = slice.position ? dot(slice.position, normal) : null
  }
  const positioned = series.every((slice) => slice.z !== null)
  if (positioned) {
    series.sort((a, b) => (a.z as number) - (b.z as number))
  } else {
    series.sort((a, b) => (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0))
  }

  const { cols, rows } = reference
  const perFrame = cols * rows
  const sliceCount = multiFrame ? (reference.frames as number) : series.length

  let data: Float32Array
  if (multiFrame) {
    data = reference.raw.length >= perFrame * sliceCount ? reference.raw : new Float32Array(perFrame * sliceCount)
    if (data !== reference.raw) data.set(reference.raw.subarray(0, Math.min(reference.raw.length, data.length)))
  } else {
    data = new Float32Array(perFrame * sliceCount)
    for (let i = 0; i < sliceCount; i++) {
      const source = series[i].raw
      data.set(source.length >= perFrame ? source.subarray(0, perFrame) : source, i * perFrame)
    }
  }

  // DICOM PixelSpacing is [between rows, between columns], i.e. y then x.
  const spacingX = reference.spacing[1]
  const spacingY = reference.spacing[0]
  let spacingZ = reference.thickness
  if (positioned && series.length > 1) {
    const span = (series[series.length - 1].z as number) - (series[0].z as number)
    const measured = Math.abs(span) / (series.length - 1)
    // Trust the measured gap only when it is physically plausible; a series with
    // duplicated positions would otherwise collapse the volume to zero depth.
    if (measured > 1e-3 && measured < 100) spacingZ = measured
  }

  const oriented = canonicalizeToLps(
    data,
    [cols, rows, sliceCount],
    [spacingX, spacingY, spacingZ || 1],
    [rowDir, colDir, normal as Vec3],
    reference.position,
  )

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < oriented.data.length; i++) {
    const v = oriented.data[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 1
  }

  const windowWidth = reference.windowWidth && reference.windowWidth > 0 ? reference.windowWidth : max - min || 1
  const windowCenter = reference.windowCenter ?? (min + max) / 2

  return {
    cols: oriented.dims[0],
    rows: oriented.dims[1],
    slices: oriented.dims[2],
    data: oriented.data,
    spacing: oriented.spacing,
    affine: oriented.affine,
    windowCenter,
    windowWidth,
    min,
    max,
    modality: reference.modality,
    description: reference.description,
  }
}

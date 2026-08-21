import type { Volume } from '../types'
import { isDicomFilename, loadDicomVolume } from './dicom'
import { isNiftiFilename, loadNiftiVolume } from './nifti'

/**
 * Decode whatever the user dropped in.
 *
 * NIfTI wins when both kinds are present: a folder containing a `.nii` next to
 * loose DICOM files is almost always a converted dataset where the NIfTI is the
 * one that was meant to be opened.
 */
export async function loadVolume(input: File[] | FileList): Promise<Volume> {
  const files = Array.from(input)
  if (!files.length) throw new Error('No files were provided.')

  const niftiFile = files.find((file) => isNiftiFilename(file.name))
  if (niftiFile) {
    const volume = await loadNiftiVolume(niftiFile)
    if (!volume) throw new Error(`${niftiFile.name} could not be read as a NIfTI volume.`)
    return volume
  }

  const candidates = files.filter((file) => isDicomFilename(file.name))
  const volume = await loadDicomVolume(candidates.length ? candidates : files)
  if (!volume) {
    throw new Error('No readable DICOM or NIfTI data was found in the selection.')
  }
  return volume
}

/* ── Demo phantom ─────────────────────────────────────────────────────────── */

/**
 * Normalised coordinates of a voxel within the phantom, in −1…1 per axis.
 * Shared by the volume and its mask so the two are guaranteed to line up.
 */
function normalised(i: number, j: number, k: number, size: number) {
  const half = (size - 1) / 2
  return { x: (i - half) / half, y: (j - half) / half, z: (k - half) / half }
}

function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
  return (x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz)
}

/**
 * A synthetic head-like volume for demos, docs and tests.
 *
 * Deliberately not a plain sphere: it carries a bright skull shell, textured
 * parenchyma and dark ventricles, which is the minimum needed to tell whether
 * window/level, MPR orientation and isosurface extraction are all behaving.
 */
export function createDemoVolume(size = 96): Volume {
  const data = new Float32Array(size * size * size)

  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const { x, y, z } = normalised(i, j, k, size)
        const head = ellipsoid(x, y, z, 0.86, 0.96, 1.0)

        let value = 0
        if (head <= 1) {
          const skull = ellipsoid(x, y, z, 0.78, 0.88, 0.92)
          if (skull > 1) {
            value = 900 + 40 * Math.sin(x * 9) // cortical bone
          } else {
            // Two octaves of low-frequency noise stand in for gyri, plus a
            // centre-bright gradient so the phantom reads like T1 white matter
            // against a darker cortex. A single high-frequency term here looks
            // like a test grating rather than tissue.
            const coarse = Math.sin(x * 6.5) * Math.cos(y * 5.5) * Math.sin(z * 6)
            const fine = Math.sin(x * 15 + z * 4) * Math.cos(y * 13)
            const depth = Math.sqrt(Math.min(1, skull))
            value = 430 + 58 * coarse + 20 * fine + 70 * (1 - depth)

            const ventricleL = ellipsoid(x + 0.17, y + 0.05, z - 0.05, 0.12, 0.3, 0.16)
            const ventricleR = ellipsoid(x - 0.17, y + 0.05, z - 0.05, 0.12, 0.3, 0.16)
            if (ventricleL <= 1 || ventricleR <= 1) value = 95

            const lesion = ellipsoid(x - 0.34, y - 0.28, z + 0.22, 0.11, 0.11, 0.11)
            if (lesion <= 1) value = 690
          }
        }

        data[i + j * size + k * size * size] = Math.max(0, value)
      }
    }
  }

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i]
    if (data[i] > max) max = data[i]
  }

  return {
    cols: size,
    rows: size,
    slices: size,
    data,
    spacing: [1.8, 1.8, 1.8],
    windowCenter: 480,
    windowWidth: 900,
    min,
    max,
    modality: 'MR',
    description: 'Synthetic demo phantom',
  }
}

/**
 * Labelmap matching {@link createDemoVolume}: 1 and 2 are the two ventricles,
 * 3 is the focal lesion.
 */
export function createDemoMask(size = 96): Uint8Array {
  const labels = new Uint8Array(size * size * size)

  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const { x, y, z } = normalised(i, j, k, size)
        let label = 0
        if (ellipsoid(x + 0.17, y + 0.05, z - 0.05, 0.12, 0.3, 0.16) <= 1) label = 1
        else if (ellipsoid(x - 0.17, y + 0.05, z - 0.05, 0.12, 0.3, 0.16) <= 1) label = 2
        else if (ellipsoid(x - 0.34, y - 0.28, z + 0.22, 0.11, 0.11, 0.11) <= 1) label = 3
        labels[i + j * size + k * size * size] = label
      }
    }
  }

  return labels
}

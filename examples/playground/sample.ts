import {
  createDemoVolume,
  defaultLabelColor,
  parseNiftiVolume,
  type LabelArray,
  type MaskOverlay,
  type Volume,
} from '../../src'
import { HARVARD_OXFORD_CORTICAL } from './harvardOxford'

/**
 * Vendored TemplateFlow copies, served from `public/` by Vite.
 *
 * T1 — FSL MNI ICBM 152 non-linear 6th generation (MNI152NLin6Asym), 1 mm.
 * © 1993–2009 Louis Collins, McConnell Brain Imaging Centre, MNI, McGill.
 * Permissive: use, copy, modify, redistribute for any purpose with this notice.
 * https://www.bic.mni.mcgill.ca/ServicesAtlases/ICBM152NLin6
 * https://templateflow.s3.amazonaws.com/tpl-MNI152NLin6Asym/tpl-MNI152NLin6Asym_res-01_T1w.nii.gz
 *
 * Overlay — Harvard–Oxford cortical maxprob 25% (FSL / CMA Harvard), same space.
 * https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Atlases
 */
const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`

export const SAMPLE_T1_URL = asset('MNI152NLin6Asym_T1_1mm.nii.gz')
export const SAMPLE_ATLAS_URL = asset('MNI152NLin6Asym_HOCPA_th25_1mm.nii.gz')

export const SAMPLE_CAPTION =
  'Sample: public MNI152 T1 1 mm (FSL / ICBM; © 1993–2009 Louis Collins, McConnell Brain Imaging Centre, MNI, McGill — free to redistribute with this notice). Overlay: Harvard–Oxford cortical maxprob 25% (FSL / CMA Harvard).'

export const SAMPLE_FALLBACK_CAPTION =
  'Could not load the public MNI152 NIfTI; showing the built-in synthetic phantom instead.'

export type PlaygroundSample = {
  volume: Volume
  overlays: MaskOverlay[]
  usedFallback: boolean
}

let cache: Promise<PlaygroundSample> | undefined

/** Fetch-and-decode once per page load; later callers share the same promise. */
export function loadPlaygroundSample(): Promise<PlaygroundSample> {
  cache ??= loadOnce()
  return cache
}

async function loadOnce(): Promise<PlaygroundSample> {
  try {
    const volume = await fetchVolume(SAMPLE_T1_URL)
    volume.description = 'MNI152NLin6Asym T1 1mm (ICBM / FSL)'
    return { volume, overlays: await loadMatchingAtlas(volume), usedFallback: false }
  } catch {
    return { volume: createDemoVolume(), overlays: [], usedFallback: true }
  }
}

async function loadMatchingAtlas(volume: Volume): Promise<MaskOverlay[]> {
  try {
    const atlas = await fetchVolume(SAMPLE_ATLAS_URL)
    if (atlas.cols !== volume.cols || atlas.rows !== volume.rows || atlas.slices !== volume.slices) {
      return []
    }
    const { labels, used } = toLabels(atlas.data)
    if (!used.length) return []
    return [
      {
        id: 'harvard-oxford',
        labels,
        dims: [atlas.cols, atlas.rows, atlas.slices],
        opacity: 0.45,
        // Colours match `labelColor` in overlay.ts. Names are FSL HOCPA 1–48.
        // Used ids are collected in the parse pass below — not on React render.
        colormap: Object.fromEntries(used.map((id) => [id, defaultLabelColor(id)])),
        names: Object.fromEntries(
          used.flatMap((id) => {
            const name = HARVARD_OXFORD_CORTICAL[id]
            return name ? [[id, name] as const] : []
          }),
        ),
      },
    ]
  } catch {
    return []
  }
}

async function fetchVolume(url: string): Promise<Volume> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  const volume = parseNiftiVolume(await response.arrayBuffer())
  if (!volume) throw new Error(`${url} is not a readable NIfTI volume`)
  return volume
}

function toLabels(data: Float32Array): { labels: LabelArray; used: number[] } {
  const seen = new Set<number>()
  let max = 0
  for (let i = 0; i < data.length; i++) {
    const value = Math.round(data[i])
    if (value <= 0) continue
    seen.add(value)
    if (value > max) max = value
  }
  const labels = max > 255 ? new Uint16Array(data.length) : new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const value = Math.round(data[i])
    labels[i] = value > 0 ? value : 0
  }
  return { labels, used: [...seen].sort((a, b) => a - b) }
}

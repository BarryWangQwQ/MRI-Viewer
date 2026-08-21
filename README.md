# MRI Viewer

**npm package:** [`medical-viewer`](https://www.npmjs.com/package/medical-viewer) · **license:** MIT

GPU-accelerated **medical volume viewer** for **DICOM** and **NIfTI**. Embed **2D slices**, linked **MPR**, and **WebGL2** **3D** volume rendering in a React app — plus read-only **mask overlays**. There is **no annotation** tooling; the viewer never edits labels.

**Live demo:** https://barrywangqwq.github.io/MRI-Viewer/

## What it is

A lightweight React component for medical volumes: **2D** orthogonal slices, linked **MPR**, and **GPU volume rendering** (WebGL2 ray-marching, with a marching-cubes mesh fallback). Arbitrary integer **label masks** composite on 2D and on the 3D cut face.

**There is no annotation tooling.** The viewer only renders masks you pass in. That keeps the surface small and makes it easy to drop into an app that already owns editing, segmentation, or reporting.

| | |
| --- | --- |
| **Formats** | Uncompressed DICOM (including enhanced multi-frame), NIfTI-1/2 (`.nii`, `.nii.gz`, 4D) |
| **2D** | Any orthogonal plane, window/level, gamma, invert, zoom, pan, voxel probe |
| **MPR** | 2×2 linked coronal / sagittal / axial + 3D, one voxel cursor |
| **3D** | WebGL2 isosurface, or a worker-built mesh. Clip-to-slice opens the volume at the current plane |
| **Playback** | Cine on the current plane (Space to play/pause) |
| **Runtime** | Fully client-side — no server, no WASM, no DICOM network layer |

Bundle is about **95 kB JS + 50 kB CSS**, with React, Three.js, and Radix left as externals.

## Install

```bash
bun add medical-viewer three
# or: npm install medical-viewer three
```

`react`, `react-dom`, and `three` are **peer dependencies**. **Styles auto-inject** when you import the component — you do **not** need:

```tsx
import 'medical-viewer/styles.css' // optional fallback only
```

Use that export if your bundler tree-shakes CSS or strips side effects.

## Quick start

```tsx
import { MedicalViewer } from 'medical-viewer'

<MedicalViewer src="https://example.com/study.nii.gz" />
```

Or a local `File` from `<input type="file">`:

```tsx
<MedicalViewer src={file} />
```

Give the parent a height. The root fills its container.

## `src` API

`src` is `string | File | File[] | FileList`.

- **`string`** — fetched as **NIfTI**. `http(s)://` and same-origin / relative URLs (`/foo.nii.gz`) work.
- **`File` / `File[]` / `FileList`** — same path as `files` (one NIfTI or a DICOM series).

Priority: **`volume` > `files` > `src`**. Browsers block **`file://`**. This repo does **not** ship a `?src=` query-string demo.

## Layouts, chrome, and theme

```tsx
<MedicalViewer
  src={file}
  layout="mpr"          // 'slice' | 'mpr' | 'volume'
  chrome={false}        // hide toolbar + side panel
  theme="light"
  className="clinical"
/>
```

| Prop | Type | Notes |
| --- | --- | --- |
| `layout` | `'slice' \| 'mpr' \| 'volume'` | 2D / MPR / 3D |
| `chrome` | `boolean` | Built-in chrome. Default `true` |
| `theme` | `'dark' \| 'light'` | Default `dark` |
| `className` / `style` | | On the `.medical-viewer` root |
| `display` | `Partial<DisplayParams>` | `windowCenter`, `windowWidth`, `gamma`, `invert` |
| `cursor` | `{ x, y, z }` | MPR crosshair voxel |
| `volumeMode` | `'gpu' \| 'mesh'` | `gpu` needs WebGL2; otherwise mesh |
| `isoThreshold` | `number` | 0–1 across the volume intensity range |
| `clipEnabled` | `boolean` | Cut 3D open at the current slice. Default `true` |
| `playing` | `boolean` | Cine of the current plane |
| `onLoad` / `onError` | | |

Every piece of view state is **optionally controlled**. Pass a prop to own it; omit it to let the component manage it. The matching callback fires either way.

### Mouse and keyboard

| Gesture | Action |
| --- | --- |
| Wheel | Previous / next slice |
| Ctrl (or ⌘) + wheel | Zoom about the cursor |
| Left drag | Pan |
| Left click | Move the crosshair |
| Right drag | Window level (vertical) and width (horizontal) |
| Double click | Reset zoom and pan |
| Space | Play / pause |

## Mask overlays

`0` is background. Pass `dims` for a volume-wide mask; omit `dims` and set `sliceIndex` for a single axial slice. Mismatched sizes are nearest-neighbour sampled.

```tsx
import { MedicalViewer, type MaskOverlay } from 'medical-viewer'

const overlays: MaskOverlay[] = [
  {
    id: 'segmentation',
    labels: labelmap,                 // Uint8Array | Uint16Array
    dims: [256, 256, 180],            // omit for a 2D mask
    colormap: { 1: '#3b82f6', 2: '#22c55e' },
    opacity: 0.45,
  },
]

<MedicalViewer src={file} overlays={overlays} />
```

Labels missing from `colormap` use a built-in palette. Supply `colormap` (and optional `names`) if you want a legend in the side panel.

## Window/level and clip-to-slice

Pin window/level while leaving gamma interactive:

```tsx
<MedicalViewer
  volume={volume}
  display={{ windowCenter: 40, windowWidth: 80 }}
  onDisplayChange={(d) => console.log(d)}
/>
```

An isosurface only shows the first threshold crossing, so a mask inside the skull stays hidden on a closed surface. **Clip to slice** (on by default) opens the volume at the current plane and paints that face with the same windowed image and masks as 2D. Play through the stack and the cut walks with you.

## Styling (scoped tokens, never `:root`)

Importing the package injects a stylesheet once (the `<style>` tag is idempotent). Tokens live on **`.medical-viewer`**, never `:root`, so a host that already defines `--background` or `--primary` keeps its theme. There is **no Tailwind preflight** on the document.

```tsx
<MedicalViewer className="midnight" volume={volume} overlays={overlays} />
```

```css
.medical-viewer.midnight {
  --radius: 0.3rem;
  --background: oklch(0.12 0.015 260);
  --primary: oklch(0.84 0.13 85);
  --viewer-canvas: oklch(0.07 0.012 260);
}
```

For portalled UI next to the viewer, put `.medical-viewer-portal` on the container.

## Compose your own chrome

`MedicalViewer` is a thin shell. The views are exported for hosts that already have a layout:

```tsx
import { MultiAxisView, SliceCanvas, VolumeView, loadVolume } from 'medical-viewer'

const volume = await loadVolume(files)

<MultiAxisView
  volume={volume}
  cursor={cursor}
  display={display}
  overlays={overlays}
  onCursorChange={setCursor}
/>
```

Also exported: `loadDicomVolume`, `loadNiftiVolume`, `parseDicomSlice`, `parseNiftiVolume`, `canonicalizeToLps`, `applyWindowLevel`, slice extractors, `VolumeRayMarcher`, `buildIsoMesh`, `createDemoVolume`, `createDemoMask`.

## Playground / local development

```bash
bun install
bun run dev              # playground at http://localhost:5173
bun run typecheck
bun run build            # library: dist/index.js (CSS injected), dist/styles.css, declarations
bun run build:playground # static site used for GitHub Pages
```

`examples/playground` is a docs-style page: drop-in `<MedicalViewer>`, composed views, and `chrome={false}`, each with a live preview and a consumer snippet. The toolbar can open a real DICOM series or NIfTI file.

## Peer dependencies

From `package.json`:

| Package | Requirement |
| --- | --- |
| `react` | `>=18` |
| `react-dom` | `>=18` |
| `three` | `>=0.160` |

## How it works (short)

Loaders permute and flip **once** into LPS (`+x` left, `+y` posterior, `+z` superior). Downstream views do not consult an affine. Oblique acquisitions stay in acquisition order.

**GPU 3D** uploads a `Data3DTexture` and ray-marches an isosurface in a fragment shader (WebGL2). **Mesh** mode runs marching cubes on a worker. Both share the same world space. Mask tint on the isosurface is GPU-only; mesh geometry is untinted. Mesh mode also snaps resolution down to a power of two.

## Limitations

- **Compressed DICOM** (JPEG / JPEG-LS / JPEG 2000) is rejected. Decompress first, or pass a decoded `volume`.
- **Colour DICOM** (`SamplesPerPixel > 1`) is not supported.
- The whole series is a `Float32Array` in memory (a 512×512×500 study is ~500 MB).
- **No DICOMweb / WADO** client.

## Sample data

Playground volumes are **not** part of the published npm package. They are vendored TemplateFlow copies in `public/`:

- **T1** — FSL MNI ICBM 152 non-linear 6th generation (MNI152NLin6Asym), 1 mm. © 1993–2009 **Louis Collins, McConnell Brain Imaging Centre, MNI, McGill**. Permissive: use, copy, modify, redistribute for any purpose with this notice. See `public/SOURCE.txt`.
- **Overlay** — **Harvard–Oxford** cortical maxprob 25% (FSL / CMA Harvard), same space.

## License

MIT. See [LICENSE](./LICENSE).

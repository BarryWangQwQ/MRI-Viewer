# MRI Viewer

**npm package:** [`medical-viewer`](https://www.npmjs.com/package/medical-viewer) · **license:** MIT

GPU-accelerated **medical volume viewer** for **DICOM** and **NIfTI**. Embed **2D slices**, linked **MPR**, and **WebGL2** **3D** volume rendering in a React app — plus read-only **mask overlays**. There is **no annotation** tooling; the viewer never edits labels.

面向 React 的 GPU 医学体数据查看器：支持 DICOM / NIfTI，**二维切片、MPR、WebGL2 三维**，以及只读掩膜叠加。**不含标注**，方便嵌入已有分割 / 报告工作流。

**Live demo / 在线演示:** https://barrywangqwq.github.io/MRI-Viewer/

---

## 中文

### 这是什么

`medical-viewer` 是一个可嵌入的 React 组件：在浏览器里打开未压缩 DICOM 序列或 NIfTI（`.nii` / `.nii.gz`，含 4D），提供窗宽窗位、缩放平移、体素探针、电影播放，以及任意整数标签掩膜。三维走 **WebGL2** 光线步进（也可回退到 marching-cubes 网格）。**没有标注、没有服务器、没有 WASM、没有 DICOMweb。**

### 安装

```bash
bun add medical-viewer three
# 或 npm install medical-viewer three
```

Peer 依赖：`react`、`react-dom`、`three`（见下方英文表）。**样式会随组件自动注入**，不必写 `import 'medical-viewer/styles.css'`。若打包器丢掉 CSS side-effect，再手动引入该可选导出。

### 快速开始

```tsx
import { MedicalViewer } from 'medical-viewer'

<MedicalViewer src="https://example.com/study.nii.gz" />
```

给父元素一个明确高度：根节点会撑满容器。

### `src` 与数据优先级

| 传入 | 行为 |
| --- | --- |
| `string` | 按 **NIfTI** 拉取：`http(s)://` 或同源 / 相对路径（如 `/foo.nii.gz`） |
| `File` / `File[]` / `FileList` | 与 `files` 相同：单个 NIfTI 或 DICOM 序列 |
| `files` | 本地文件 |
| `volume` | 已解码的 `Volume` |

优先级：**`volume` > `files` > `src`**。浏览器会拦截 **`file://`**，请用 `<input type="file">` 得到的 `File`。Playground **没有** `?src=` 查询参数演示。

### 常用 props

| Prop | 说明 |
| --- | --- |
| `layout` | `'slice'`（2D）· `'mpr'`（MPR）· `'volume'`（3D） |
| `chrome={false}` | 隐藏内置工具栏和侧栏，只留画面 |
| `theme` | `'dark'`（默认）或 `'light'` |
| `className` / `style` | 挂在根节点 `.medical-viewer` 上 |
| `display` | 窗位 / 窗宽 / gamma / invert（可字段合并） |
| `overlays` | 只读掩膜 |
| `clipEnabled` | 三维沿当前切面剖开（默认开） |
| `volumeMode` | `'gpu'`（WebGL2）或 `'mesh'` |

状态均可受控：传入 prop 即由宿主接管，省略则组件自管；对应 `on…Change` 始终会触发。

### 掩膜、窗宽窗位、切面剖开

掩膜是整数 labelmap（`0` 为背景）。体数据掩膜传 `dims`；单层轴位掩膜可省略 `dims` 并设 `sliceIndex`。尺寸与体不一致时做最近邻采样。

```tsx
import { MedicalViewer, type MaskOverlay } from 'medical-viewer'

const overlays: MaskOverlay[] = [
  {
    id: 'segmentation',
    labels: labelmap,
    dims: [256, 256, 180],
    colormap: { 1: '#3b82f6', 2: '#22c55e' },
    opacity: 0.45,
  },
]

<MedicalViewer src={file} overlays={overlays} />
```

`display={{ windowCenter, windowWidth }}` 可钉住窗宽窗位。三维默认 **clip-to-slice**：沿当前切片切开，切面与二维使用同一套窗宽和掩膜，内部标签才看得见。

### 样式

设计 token **只写在 `.medical-viewer`（以及 portal 根）上，从不写 `:root`**，避免污染宿主主题。覆盖 CSS 变量即可换肤：

```css
.medical-viewer.clinical {
  --radius: 0.25rem;
  --background: oklch(0.99 0.002 250);
  --primary: oklch(0.48 0.11 250);
  --viewer-canvas: oklch(0.945 0.008 250);
}
```

弹出层等传送到组件外的内容，在容器上加 `.medical-viewer-portal`。

### 本地 playground

```bash
bun install
bun run dev              # http://localhost:5173
bun run typecheck
bun run build            # 库：dist/index.js（已注入 CSS）+ dist/styles.css
bun run build:playground # 静态演示站（本仓库 GitHub Pages 用）
```

示例在 `examples/playground`。

### 示例数据与许可

Playground 样例：公开 **MNI152** T1 1 mm（FSL / ICBM；© 1993–2009 Louis Collins, McConnell Brain Imaging Centre, MNI, McGill，可在保留声明的前提下再分发）。叠加：**Harvard–Oxford** 皮层 maxprob 25%（FSL / CMA Harvard）。详见 `public/SOURCE.txt`。

本库为 **MIT**。

---

## English

### What it is

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

### Install

```bash
bun add medical-viewer three
# or: npm install medical-viewer three
```

`react`, `react-dom`, and `three` are **peer dependencies**. **Styles auto-inject** when you import the component — you do **not** need:

```tsx
import 'medical-viewer/styles.css' // optional fallback only
```

Use that export if your bundler tree-shakes CSS or strips side effects.

### Quick start

```tsx
import { MedicalViewer } from 'medical-viewer'

<MedicalViewer src="https://example.com/study.nii.gz" />
```

Or a local `File` from `<input type="file">`:

```tsx
<MedicalViewer src={file} />
```

Give the parent a height. The root fills its container.

### `src` API

`src` is `string | File | File[] | FileList`.

- **`string`** — fetched as **NIfTI**. `http(s)://` and same-origin / relative URLs (`/foo.nii.gz`) work.
- **`File` / `File[]` / `FileList`** — same path as `files` (one NIfTI or a DICOM series).

Priority: **`volume` > `files` > `src`**. Browsers block **`file://`**. This repo does **not** ship a `?src=` query-string demo.

### Layouts, chrome, and theme

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

#### Mouse and keyboard

| Gesture | Action |
| --- | --- |
| Wheel | Previous / next slice |
| Ctrl (or ⌘) + wheel | Zoom about the cursor |
| Left drag | Pan |
| Left click | Move the crosshair |
| Right drag | Window level (vertical) and width (horizontal) |
| Double click | Reset zoom and pan |
| Space | Play / pause |

### Mask overlays

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

### Window/level and clip-to-slice

Pin window/level while leaving gamma interactive:

```tsx
<MedicalViewer
  volume={volume}
  display={{ windowCenter: 40, windowWidth: 80 }}
  onDisplayChange={(d) => console.log(d)}
/>
```

An isosurface only shows the first threshold crossing, so a mask inside the skull stays hidden on a closed surface. **Clip to slice** (on by default) opens the volume at the current plane and paints that face with the same windowed image and masks as 2D. Play through the stack and the cut walks with you.

### Styling (scoped tokens, never `:root`)

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

### Compose your own chrome

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

### Playground / local development

```bash
bun install
bun run dev              # playground at http://localhost:5173
bun run typecheck
bun run build            # library: dist/index.js (CSS injected), dist/styles.css, declarations
bun run build:playground # static site used for GitHub Pages
```

`examples/playground` is a docs-style page: drop-in `<MedicalViewer>`, composed views, and `chrome={false}`, each with a live preview and a consumer snippet. The toolbar can open a real DICOM series or NIfTI file.

### Peer dependencies

From `package.json`:

| Package | Requirement |
| --- | --- |
| `react` | `>=18` |
| `react-dom` | `>=18` |
| `three` | `>=0.160` |

### How it works (short)

Loaders permute and flip **once** into LPS (`+x` left, `+y` posterior, `+z` superior). Downstream views do not consult an affine. Oblique acquisitions stay in acquisition order.

**GPU 3D** uploads a `Data3DTexture` and ray-marches an isosurface in a fragment shader (WebGL2). **Mesh** mode runs marching cubes on a worker. Both share the same world space. Mask tint on the isosurface is GPU-only; mesh geometry is untinted. Mesh mode also snaps resolution down to a power of two.

### Limitations

- **Compressed DICOM** (JPEG / JPEG-LS / JPEG 2000) is rejected. Decompress first, or pass a decoded `volume`.
- **Colour DICOM** (`SamplesPerPixel > 1`) is not supported.
- The whole series is a `Float32Array` in memory (a 512×512×500 study is ~500 MB).
- **No DICOMweb / WADO** client.

### Sample data

Playground volumes are **not** part of the published npm package. They are vendored TemplateFlow copies in `public/`:

- **T1** — FSL MNI ICBM 152 non-linear 6th generation (MNI152NLin6Asym), 1 mm. © 1993–2009 **Louis Collins, McConnell Brain Imaging Centre, MNI, McGill**. Permissive: use, copy, modify, redistribute for any purpose with this notice. See `public/SOURCE.txt`.
- **Overlay** — **Harvard–Oxford** cortical maxprob 25% (FSL / CMA Harvard), same space.

### License

MIT. See [LICENSE](./LICENSE).

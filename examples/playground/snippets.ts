/** Consumer usage shown in the playground. Not the library source. */

export const LANDING_SNIPPET = `import { MedicalViewer } from 'medical-viewer'

<MedicalViewer src="https://example.com/study.nii.gz" />`

export const DROP_IN_SNIPPET = `import { MedicalViewer } from 'medical-viewer'

<MedicalViewer volume={volume} overlays={overlays} />`

export const COMPOSED_SNIPPET = `import { useState } from 'react'
import { MultiAxisView, SliceCanvas } from 'medical-viewer'

export function Study() {
  const [cursor, setCursor] = useState({
    x: volume.cols >> 1,
    y: volume.rows >> 1,
    z: volume.slices >> 1,
  })
  const [display, setDisplay] = useState({
    windowCenter: volume.windowCenter,
    windowWidth: volume.windowWidth,
    gamma: 1,
    invert: false,
  })

  return (
    <div className="medical-viewer dark" style={{ height: 640, display: 'flex' }}>
      <MultiAxisView
        volume={volume}
        cursor={cursor}
        display={display}
        overlays={overlays}
        onCursorChange={setCursor}
        onDisplayChange={setDisplay}
      />
      <SliceCanvas
        volume={volume}
        axis="axial"
        index={cursor.z}
        display={display}
        overlays={overlays}
        label="Detail"
        onIndexChange={(z) => setCursor({ ...cursor, z })}
        onDisplayChange={setDisplay}
      />
    </div>
  )
}`

export const HEADLESS_SNIPPET = `import { MedicalViewer } from 'medical-viewer'

<MedicalViewer volume={volume} overlays={overlays} chrome={false} layout="mpr" />`

export const CLINICAL_SNIPPET = `import { MedicalViewer } from 'medical-viewer'

<MedicalViewer
  className="clinical"
  theme="light"
  volume={volume}
  overlays={overlays}
/>

/* Scoped to .medical-viewer — not :root */
.clinical {
  --radius: 0.25rem;
  --background: oklch(0.99 0.002 250);
  --foreground: oklch(0.28 0.025 250);
  --primary: oklch(0.48 0.11 250);
  --border: oklch(0.86 0.012 250);
  --viewer-canvas: oklch(0.945 0.008 250);
}`

export const MIDNIGHT_SNIPPET = `import { MedicalViewer } from 'medical-viewer'

<MedicalViewer className="midnight" volume={volume} overlays={overlays} />

.midnight {
  --radius: 0.3rem;
  --background: oklch(0.12 0.015 260);
  --foreground: oklch(0.97 0.012 95);
  --primary: oklch(0.84 0.13 85);
  --viewer-canvas: oklch(0.07 0.012 260);
}`

export const EDITORIAL_SNIPPET = `import { MedicalViewer } from 'medical-viewer'

<MedicalViewer className="editorial" volume={volume} overlays={overlays} />

.editorial {
  --radius: 1.25rem;
  --background: oklch(0.2 0.025 305);
  --primary: oklch(0.74 0.1 305);
  --viewer-canvas: oklch(0.14 0.03 305);
}`

export const VOLUME_SNIPPET = `import { MedicalViewer } from 'medical-viewer'

<MedicalViewer volume={volume} overlays={overlays} layout="volume" />`

export const LIGHT_SNIPPET = `import { MedicalViewer } from 'medical-viewer'

<MedicalViewer volume={volume} overlays={overlays} theme="light" />`

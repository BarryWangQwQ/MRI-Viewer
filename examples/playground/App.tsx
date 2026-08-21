import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import {
  MedicalViewer,
  MultiAxisView,
  SliceCanvas,
  type DisplayParams,
  type MaskOverlay,
  type Volume,
  type VoxelCursor,
} from '../../src'
import { packedMaskVolume } from '../../src/render/overlay'
import { DEFAULT_VOLUME_RESOLUTION } from '../../src/views/VolumeView'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { containOverscroll } from '@/lib/containWheel'
import { cn } from '@/lib/utils'
import {
  loadPlaygroundSample,
  SAMPLE_CAPTION,
  SAMPLE_FALLBACK_CAPTION,
  type PlaygroundSample,
} from './sample'
import {
  CLINICAL_SNIPPET,
  COMPOSED_SNIPPET,
  DROP_IN_SNIPPET,
  EDITORIAL_SNIPPET,
  HEADLESS_SNIPPET,
  LANDING_SNIPPET,
  LIGHT_SNIPPET,
  MIDNIGHT_SNIPPET,
  VOLUME_SNIPPET,
} from './snippets'

type ExampleId = 'drop-in' | 'composed' | 'headless' | 'themes' | 'volume-3d' | 'light'

type HostTheme = 'clinical' | 'midnight' | 'editorial'

const HOST_THEMES: { id: HostTheme; label: string; className: string; theme: 'dark' | 'light'; code: string }[] = [
  { id: 'clinical', label: 'Clinical', className: 'pg-theme-clinical', theme: 'light', code: CLINICAL_SNIPPET },
  { id: 'midnight', label: 'Midnight', className: 'pg-theme-midnight', theme: 'dark', code: MIDNIGHT_SNIPPET },
  { id: 'editorial', label: 'Editorial', className: 'pg-theme-editorial', theme: 'dark', code: EDITORIAL_SNIPPET },
]

const EXAMPLES: { id: ExampleId; label: string; lead: string; code: string }[] = [
  {
    id: 'drop-in',
    label: 'MedicalViewer',
    lead: 'Drop-in component with its own toolbar, layouts, and side panel.',
    code: DROP_IN_SNIPPET,
  },
  {
    id: 'composed',
    label: 'Composed',
    lead: 'Host-owned cursor and window/level, laid out with MultiAxisView and SliceCanvas.',
    code: COMPOSED_SNIPPET,
  },
  {
    id: 'headless',
    label: 'chrome={false}',
    lead: 'Same viewer without the built-in toolbar and side panel — your chrome, our views.',
    code: HEADLESS_SNIPPET,
  },
  {
    id: 'themes',
    label: 'Custom styles',
    lead: 'Host themes — Clinical, Midnight, and Editorial — via className and scoped tokens.',
    code: MIDNIGHT_SNIPPET,
  },
  {
    id: 'volume-3d',
    label: 'layout="volume"',
    lead: 'Open on the GPU volume view instead of the default MPR grid.',
    code: VOLUME_SNIPPET,
  },
  {
    id: 'light',
    label: 'theme="light"',
    lead: 'Same chrome and views, with the built-in light token set.',
    code: LIGHT_SNIPPET,
  },
]

export function App() {
  const [example, setExample] = useState<ExampleId>('drop-in')
  const [hostTheme, setHostTheme] = useState<HostTheme>('midnight')
  const [withMask, setWithMask] = useState(true)
  const [sample, setSample] = useState<PlaygroundSample | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadPlaygroundSample().then((next) => {
      if (!cancelled) setSample(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const active = EXAMPLES.find((item) => item.id === example) ?? EXAMPLES[0]
  const selectedHostTheme =
    HOST_THEMES.find((item) => item.id === hostTheme) ?? HOST_THEMES[1]
  const panelCode = example === 'themes' ? selectedHostTheme.code : active.code
  const overlays = sample?.overlays ?? []
  // Keep the same overlay objects; hide with `visible` so VolumeView can reuse
  // the packed 96³ cube instead of tearing it down on every toggle.
  const mask = useMemo<MaskOverlay[] | undefined>(() => {
    if (!overlays.length) return undefined
    return withMask ? overlays : overlays.map((overlay) => ({ ...overlay, visible: false }))
  }, [overlays, withMask])
  const volume = sample?.volume

  useEffect(() => {
    if (!sample?.overlays.length) return
    const warm = () => {
      packedMaskVolume(sample.overlays, DEFAULT_VOLUME_RESOLUTION)
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(warm)
      return () => cancelIdleCallback(id)
    }
    const timer = window.setTimeout(warm, 0)
    return () => clearTimeout(timer)
  }, [sample])

  return (
    <div className="medical-viewer-portal dark pg-page h-svh overflow-hidden">
      <div className="pg-wrap flex h-full min-h-0 w-full max-w-none flex-col px-4">
        <div className="pg-split flex h-full min-h-0 w-full flex-1 flex-col lg:flex-row">
          <aside className="pg-brand flex h-full w-[30rem] min-w-[30rem] shrink-0 flex-col">
            <header className="pg-intro shrink-0">
              <h1 className="pg-title text-3xl">MRI Viewer</h1>
              <p className="pg-lead">
                A modern, GPU-accelerated medical volume viewer for DICOM and NIfTI. Drop in
                2D, MPR, and 3D with mask overlays — simple API, fast to integrate.
              </p>
            </header>

            <LandingSnippet />

            <div className="pg-brand-examples min-h-0 flex-1">
              <p className="pg-kicker">Examples</p>
              <ScrollArea className="pg-example-scroll h-full min-h-0">
                <div className="pg-example-cards">
                  {EXAMPLES.map((item) => {
                    const selected = item.id === example
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={selected}
                        className="pg-example-card"
                        onClick={() => setExample(item.id)}
                      >
                        <Card
                          size="sm"
                          className={cn(
                            'h-auto w-full gap-0 py-2.5 [--card-spacing:--spacing(3)]',
                            selected && 'ring-2 ring-primary',
                          )}
                        >
                          <CardHeader className="gap-1 px-3 py-0">
                            <CardTitle>{item.label}</CardTitle>
                            <CardDescription>{item.lead}</CardDescription>
                          </CardHeader>
                        </Card>
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>

            <footer className="pg-footer shrink-0">
              <p className="text-[11px] font-normal leading-relaxed text-muted-foreground opacity-80">
                Medical Viewer is MIT licensed. Built with Three.js, shadcn/ui (Radix), Lucide,
                dicom-parser, nifti-reader-js, and marching-cubes-fast.
              </p>
              <p className="text-[11px] font-normal leading-relaxed text-muted-foreground opacity-70">
                {sample?.usedFallback ? SAMPLE_FALLBACK_CAPTION : SAMPLE_CAPTION}
              </p>
            </footer>
          </aside>

          <section className="pg-stage flex min-h-0 min-w-0 flex-1 flex-col">
            <ExamplePanel
              key={example}
              code={panelCode}
              withMask={withMask}
              onWithMaskChange={setWithMask}
              showMaskToggle={overlays.length > 0}
              themeSwitch={
                example === 'themes' ? (
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={hostTheme}
                    onValueChange={(value) => {
                      if (value) setHostTheme(value as HostTheme)
                    }}
                    aria-label="Host theme"
                  >
                    {HOST_THEMES.map((item) => (
                      <ToggleGroupItem key={item.id} value={item.id}>
                        {item.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                ) : null
              }
            >
              {!volume ? (
                <div className="pg-skeleton">
                  <Skeleton className="size-full rounded-none" />
                </div>
              ) : null}
              {volume && example === 'drop-in' ? (
                <MedicalViewer className="h-full w-full" volume={volume} overlays={mask} />
              ) : null}
              {volume && example === 'composed' ? (
                <Composed volume={volume} overlays={mask} />
              ) : null}
              {volume && example === 'headless' ? (
                <MedicalViewer
                  className="h-full w-full"
                  volume={volume}
                  overlays={mask}
                  chrome={false}
                  layout="mpr"
                />
              ) : null}
              {volume && example === 'themes' ? (
                <MedicalViewer
                  className={cn('h-full w-full', selectedHostTheme.className)}
                  theme={selectedHostTheme.theme}
                  volume={volume}
                  overlays={mask}
                />
              ) : null}
              {volume && example === 'volume-3d' ? (
                <MedicalViewer
                  className="h-full w-full"
                  volume={volume}
                  overlays={mask}
                  layout="volume"
                />
              ) : null}
              {volume && example === 'light' ? (
                <MedicalViewer
                  className="h-full w-full"
                  volume={volume}
                  overlays={mask}
                  theme="light"
                />
              ) : null}
            </ExamplePanel>
          </section>
        </div>
      </div>
    </div>
  )
}

function LandingSnippet() {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  async function copySnippet() {
    await navigator.clipboard.writeText(LANDING_SNIPPET)
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="pg-landing">
      <div className="pg-landing-frame rounded-xl">
        <Button
          variant="ghost"
          size="icon-xs"
          className="pg-landing-copy"
          onClick={() => void copySnippet()}
          aria-label={copied ? 'Copied' : 'Copy'}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
        <CodeBlock code={LANDING_SNIPPET} />
      </div>
    </div>
  )
}

const PREVIEW_CODE_TAB =
  'flex-none self-center px-2.5 py-0 leading-none text-center appearance-none'

function ExamplePanel({
  code,
  withMask,
  onWithMaskChange,
  showMaskToggle,
  themeSwitch,
  children,
}: {
  code: string
  withMask: boolean
  onWithMaskChange: (next: boolean) => void
  showMaskToggle: boolean
  themeSwitch?: ReactNode
  children: ReactNode
}) {
  const [view, setView] = useState('preview')
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const previewFrameRef = useRef<HTMLDivElement>(null)
  const codeFrameRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  useEffect(() => {
    const nodes = [previewFrameRef.current, codeFrameRef.current].filter(
      (node): node is HTMLDivElement => node != null,
    )
    const onWheel = (event: WheelEvent) => containOverscroll(event)
    for (const node of nodes) {
      node.addEventListener('wheel', onWheel, { passive: false })
    }
    return () => {
      for (const node of nodes) {
        node.removeEventListener('wheel', onWheel)
      }
    }
  }, [view])

  async function copySnippet() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <Tabs className="flex min-h-0 min-w-0 w-full flex-1 flex-col" value={view} onValueChange={setView}>
      <div className="pg-toolbar shrink-0">
        <div className="pg-toolbar-start">
          <TabsList className="h-8">
            <TabsTrigger value="preview" className={PREVIEW_CODE_TAB}>
              Preview
            </TabsTrigger>
            <TabsTrigger value="code" className={PREVIEW_CODE_TAB}>
              Code
            </TabsTrigger>
          </TabsList>
          {themeSwitch}
        </div>
        <div className="pg-actions">
          {view === 'preview' && showMaskToggle ? (
            <label className="pg-mask">
              <Switch
                size="sm"
                checked={withMask}
                onCheckedChange={onWithMaskChange}
              />
              Mask overlay
            </label>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void copySnippet()}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      <TabsContent value="preview" className="min-h-0 min-w-0 w-full flex-1">
        <div ref={previewFrameRef} className="pg-frame h-full min-h-0 w-full overscroll-contain rounded-2xl">
          <div className="pg-preview h-full min-h-0 w-full">{children}</div>
        </div>
      </TabsContent>

      <TabsContent value="code" className="min-h-0 min-w-0 w-full flex-1">
        <div ref={codeFrameRef} className="pg-frame pg-code-wrap h-full min-h-0 w-full overscroll-contain rounded-2xl">
          {view === 'code' ? (
            <ScrollArea className="h-full min-h-0 w-full overscroll-contain">
              <CodeBlock code={code} />
            </ScrollArea>
          ) : null}
        </div>
      </TabsContent>
    </Tabs>
  )
}

function CodeBlock({ code }: { code: string }) {
  const [html, setHtml] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void import('./highlighted').then(({ htmlForSnippet }) => {
      if (!cancelled) setHtml(htmlForSnippet(code))
    })
    return () => {
      cancelled = true
    }
  }, [code])

  if (!html) {
    return (
      <pre className="pg-code" aria-busy="true">
        <code>{code}</code>
      </pre>
    )
  }

  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

function Composed({ volume, overlays }: { volume: Volume; overlays?: MaskOverlay[] }) {
  const [cursor, setCursor] = useState<VoxelCursor>({
    x: volume.cols >> 1,
    y: volume.rows >> 1,
    z: volume.slices >> 1,
  })
  const [display, setDisplay] = useState<DisplayParams>({
    windowCenter: volume.windowCenter,
    windowWidth: volume.windowWidth,
    gamma: 1,
    invert: false,
  })

  return (
    <div className="medical-viewer dark pg-composed">
      <div className="pg-composed-mpr">
        <MultiAxisView
          volume={volume}
          cursor={cursor}
          display={display}
          overlays={overlays}
          onCursorChange={setCursor}
          onDisplayChange={setDisplay}
        />
      </div>
      <div className="pg-composed-side">
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
        <div className="pg-status">
          cursor ({cursor.x}, {cursor.y}, {cursor.z}) · window {display.windowCenter.toFixed(0)} /{' '}
          {display.windowWidth.toFixed(0)}
        </div>
      </div>
    </div>
  )
}

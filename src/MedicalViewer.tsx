import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, Image as ImageIcon } from 'lucide-react'
import type {
  Axis,
  DisplayParams,
  Layout,
  MaskOverlay,
  MedicalViewerProps,
  MedicalViewerSrc,
  Volume,
  VoxelCursor,
} from './types'
import { loadNiftiFromUrl } from './load/nifti'
import { loadVolume } from './load/volume'
import { sliceCount } from './render/planes'
import { SliceCanvas } from './views/SliceCanvas'
import { MultiAxisView } from './views/MultiAxisView'
import { VolumeView } from './views/VolumeView'
import { ViewerToolbar } from './chrome/ViewerToolbar'
import { ControlPanel } from './chrome/ControlPanel'
import { SlicePlayer } from './chrome/SlicePlayer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { containOverscroll } from '@/lib/containWheel'
import { cn } from '@/lib/utils'

const DEFAULT_PLAY_INTERVAL_MS = 80

const DEFAULT_DISPLAY: DisplayParams = {
  windowCenter: 0.5,
  windowWidth: 1,
  gamma: 1,
  invert: false,
}

const DEFAULT_MASK_OPACITY = 0.45

function asFileArray(input: File | File[] | FileList): File[] {
  if (input instanceof File) return [input]
  return Array.from(input)
}

/** Prop files win over `src` files. Toolbar picks sit above both. */
function resolveSourceFiles(
  picked: File[] | null,
  files: MedicalViewerProps['files'],
  src: MedicalViewerSrc | undefined,
): File[] | null {
  if (picked?.length) return picked
  if (files && files.length) return Array.from(files)
  if (src != null && typeof src !== 'string') {
    const list = asFileArray(src)
    return list.length ? list : null
  }
  return null
}

function resolveSourceUrl(src: MedicalViewerSrc | undefined): string | null {
  if (typeof src !== 'string') return null
  const trimmed = src.trim()
  return trimmed || null
}

function displayForVolume(volume: Volume): DisplayParams {
  return { windowCenter: volume.windowCenter, windowWidth: volume.windowWidth, gamma: 1, invert: false }
}

function centreOf(volume: Volume): VoxelCursor {
  return {
    x: Math.floor(volume.cols / 2),
    y: Math.floor(volume.rows / 2),
    z: Math.floor(volume.slices / 2),
  }
}

function defaultThreshold(volume: Volume): number {
  const range = volume.max - volume.min || 1
  return Math.max(0.05, Math.min(0.95, (volume.windowCenter - volume.min) / range))
}

/**
 * Self-contained medical volume viewer for DICOM series and NIfTI.
 *
 * Every piece of state is optionally controlled: pass `layout`, `sliceIndex`,
 * `display`, `cursor`, `volumeMode`, `isoThreshold`, `playing` or `clipEnabled`
 * to drive the viewer from outside, or leave them out and let it manage itself.
 * The corresponding `on…Change` callback always fires either way, so a host can
 * observe without taking over.
 */
export function MedicalViewer({
  files,
  volume: volumeProp,
  src,
  layout: layoutProp,
  onLayoutChange,
  sliceIndex,
  onSliceChange,
  display: displayProp,
  onDisplayChange,
  overlays,
  cursor: cursorProp,
  onCursorChange,
  onLoad,
  onError,
  theme = 'dark',
  className,
  style,
  chrome = true,
  volumeMode: volumeModeProp,
  isoThreshold: isoThresholdProp,
  playing: playingProp,
  onPlayingChange,
  playIntervalMs = DEFAULT_PLAY_INTERVAL_MS,
  clipEnabled: clipEnabledProp,
  onClipEnabledChange,
}: MedicalViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  useEffect(() => setPortalContainer(rootRef.current), [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (event: WheelEvent) => containOverscroll(event)
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  /* ── Volume ─────────────────────────────────────────────────────────────── */

  const [pickedFiles, setPickedFiles] = useState<File[] | null>(null)
  const [loadedVolume, setLoadedVolume] = useState<Volume | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sourceFiles = useMemo(
    () => resolveSourceFiles(pickedFiles, files, src),
    [pickedFiles, files, src],
  )
  const sourceUrl = resolveSourceUrl(src)

  useEffect(() => {
    if (volumeProp) {
      setError(null)
      setLoading(false)
      return
    }

    const fileList = sourceFiles?.length ? sourceFiles : null
    if (!fileList && !sourceUrl) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const task = fileList
      ? loadVolume(fileList)
      : loadNiftiFromUrl(sourceUrl ?? '')
    task
      .then((result) => {
        if (cancelled) return
        setLoadedVolume(result)
        onLoad?.(result)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        const failure = cause instanceof Error ? cause : new Error(String(cause))
        setLoadedVolume(null)
        setError(failure.message)
        onError?.(failure)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // `onLoad` / `onError` are intentionally excluded: re-running a decode
    // because the host passed a fresh closure would be wasteful and visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFiles, volumeProp, sourceUrl])

  const volume = volumeProp ?? loadedVolume

  /* ── View state ─────────────────────────────────────────────────────────── */

  const [internalLayout, setInternalLayout] = useState<Layout>('slice')
  const layout = layoutProp ?? internalLayout
  const setLayout = useCallback(
    (next: Layout) => {
      if (layoutProp === undefined) setInternalLayout(next)
      onLayoutChange?.(next)
    },
    [layoutProp, onLayoutChange],
  )

  const [axis, setAxis] = useState<Axis>('axial')

  const [internalDisplay, setInternalDisplay] = useState<DisplayParams>(DEFAULT_DISPLAY)
  // Props win field by field, so a host can pin just the window and still let the
  // user drive gamma.
  const display = useMemo<DisplayParams>(() => ({ ...internalDisplay, ...displayProp }), [internalDisplay, displayProp])
  const setDisplay = useCallback(
    (next: DisplayParams) => {
      setInternalDisplay(next)
      onDisplayChange?.(next)
    },
    [onDisplayChange],
  )

  const [internalCursor, setInternalCursor] = useState<VoxelCursor>({ x: 0, y: 0, z: 0 })
  const cursor = cursorProp ?? internalCursor
  const setCursor = useCallback(
    (next: VoxelCursor) => {
      if (!volume) return
      const clamped: VoxelCursor = {
        x: Math.max(0, Math.min(volume.cols - 1, Math.round(next.x))),
        y: Math.max(0, Math.min(volume.rows - 1, Math.round(next.y))),
        z: Math.max(0, Math.min(volume.slices - 1, Math.round(next.z))),
      }
      if (cursorProp === undefined) setInternalCursor(clamped)
      onCursorChange?.(clamped)
    },
    [volume, cursorProp, onCursorChange],
  )

  const [internalVolumeMode, setInternalVolumeMode] = useState<'gpu' | 'mesh'>('gpu')
  const volumeMode = volumeModeProp ?? internalVolumeMode

  const [internalThreshold, setInternalThreshold] = useState(0.3)
  const isoThreshold = isoThresholdProp ?? internalThreshold

  const [showCrosshair, setShowCrosshair] = useState(true)
  const [hiddenOverlays, setHiddenOverlays] = useState<Set<string>>(() => new Set())
  const [maskOpacity, setMaskOpacity] = useState(DEFAULT_MASK_OPACITY)

  const [internalClip, setInternalClip] = useState(true)
  const clipEnabled = clipEnabledProp ?? internalClip
  const setClipEnabled = useCallback(
    (next: boolean) => {
      if (clipEnabledProp === undefined) setInternalClip(next)
      onClipEnabledChange?.(next)
    },
    [clipEnabledProp, onClipEnabledChange],
  )

  const [internalPlaying, setInternalPlaying] = useState(false)
  const playing = playingProp ?? internalPlaying
  const setPlaying = useCallback(
    (next: boolean) => {
      if (playingProp === undefined) setInternalPlaying(next)
      onPlayingChange?.(next)
      if (next) setClipEnabled(true)
    },
    [playingProp, onPlayingChange, setClipEnabled],
  )

  // Re-derive everything that depends on the data when a new volume arrives.
  useEffect(() => {
    if (!volume) return
    setInternalDisplay(displayForVolume(volume))
    setInternalCursor(centreOf(volume))
    setInternalThreshold(defaultThreshold(volume))
    setHiddenOverlays(new Set())
    setInternalPlaying(false)
  }, [volume])

  /* ── Derived ────────────────────────────────────────────────────────────── */

  const axisIndex = useMemo(() => {
    if (sliceIndex !== undefined) return sliceIndex
    return axis === 'axial' ? cursor.z : axis === 'coronal' ? cursor.y : cursor.x
  }, [sliceIndex, axis, cursor])

  const setAxisIndex = useCallback(
    (next: number) => {
      const key = axis === 'axial' ? 'z' : axis === 'coronal' ? 'y' : 'x'
      setCursor({ ...cursor, [key]: next })
      onSliceChange?.(next)
    },
    [axis, cursor, setCursor, onSliceChange],
  )

  const axisIndexRef = useRef(axisIndex)
  axisIndexRef.current = axisIndex

  useEffect(() => {
    if (!playing || !volume) return
    const total = sliceCount(volume, axis)
    if (total <= 1) {
      setPlaying(false)
      return
    }
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      if (now - last >= playIntervalMs) {
        last = now
        const current = axisIndexRef.current
        if (current >= total - 1) {
          setPlaying(false)
          return
        }
        setAxisIndex(current + 1)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, volume, axis, playIntervalMs, setAxisIndex, setPlaying])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const root = rootRef.current
      if (!root) return
      if (!root.contains(target) && !root.contains(document.activeElement) && document.activeElement !== document.body) {
        return
      }
      event.preventDefault()
      setPlaying(!playing)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, setPlaying])

  /**
   * Overlays as the views should see them: the panel's local visibility and
   * opacity are folded in here rather than mutating what the host passed.
   */
  const resolvedOverlays = useMemo<MaskOverlay[] | undefined>(() => {
    if (!overlays?.length) return overlays
    return overlays.map((overlay) => ({
      ...overlay,
      visible: overlay.visible !== false && !hiddenOverlays.has(overlay.id),
      opacity: maskOpacity,
    }))
  }, [overlays, hiddenOverlays, maskOpacity])

  const handleReset = useCallback(() => {
    if (!volume) return
    setDisplay(displayForVolume(volume))
    setCursor(centreOf(volume))
    setInternalThreshold(defaultThreshold(volume))
  }, [volume, setDisplay, setCursor])

  const toggleOverlay = useCallback((id: string, visible: boolean) => {
    setHiddenOverlays((current) => {
      const next = new Set(current)
      if (visible) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /* ── Render ─────────────────────────────────────────────────────────────── */

  const total = volume ? sliceCount(volume, axis) : 0

  return (
    <div
      ref={rootRef}
      className={cn(
        'medical-viewer h-full w-full min-h-0 flex-col overscroll-contain',
        theme === 'dark' && 'dark',
        className,
      )}
      style={style}
    >
      {chrome ? (
        <ViewerToolbar
          volume={volume}
          layout={layout}
          onLayoutChange={setLayout}
          axis={axis}
          onAxisChange={setAxis}
          onOpenFiles={setPickedFiles}
          onReset={handleReset}
          showPicker={!volumeProp}
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error ? (
            <div className="p-3">
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Could not open the study</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
              <Skeleton className="flex-1" />
              <Skeleton className="h-3 w-40" />
            </div>
          ) : null}

          {!loading && !volume && !error ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden bg-[var(--viewer-canvas)] text-muted-foreground">
              <ImageIcon className="size-7 opacity-40" />
              <p className="text-xs">
                {chrome ? 'Open a DICOM series or NIfTI file to begin.' : 'No volume provided.'}
              </p>
            </div>
          ) : null}

          {!loading && volume ? (
            <>
              {layout === 'slice' ? (
                <SliceCanvas
                  volume={volume}
                  axis={axis}
                  index={axisIndex}
                  display={display}
                  overlays={resolvedOverlays}
                  crosshair={cursor}
                  showIndex={!chrome}
                  onIndexChange={setAxisIndex}
                  onDisplayChange={setDisplay}
                  onVoxelClick={setCursor}
                />
              ) : null}

              {layout === 'mpr' ? (
                <MultiAxisView
                  volume={volume}
                  cursor={cursor}
                  display={display}
                  overlays={resolvedOverlays}
                  onCursorChange={setCursor}
                  onDisplayChange={setDisplay}
                  showCrosshair={showCrosshair}
                  volumeMode={volumeMode}
                  isoThreshold={isoThreshold}
                  clipEnabled={clipEnabled}
                  clipAxis={axis}
                />
              ) : null}

              {layout === 'volume' ? (
                <VolumeView
                  volume={volume}
                  overlays={resolvedOverlays}
                  display={display}
                  mode={volumeMode}
                  isoThreshold={isoThreshold}
                  clipEnabled={clipEnabled}
                  clipAxis={axis}
                  clipIndex={axisIndex}
                />
              ) : null}

              {chrome && total > 1 ? (
                <SlicePlayer
                  index={axisIndex}
                  total={total}
                  playing={playing}
                  onIndexChange={setAxisIndex}
                  onPlayingChange={setPlaying}
                />
              ) : null}
            </>
          ) : null}
        </div>

        {chrome && volume ? (
          <ControlPanel
            volume={volume}
            display={display}
            onDisplayChange={setDisplay}
            layout={layout}
            overlays={overlays ?? []}
            hiddenOverlays={hiddenOverlays}
            onToggleOverlay={toggleOverlay}
            maskOpacity={maskOpacity}
            onMaskOpacityChange={setMaskOpacity}
            showCrosshair={showCrosshair}
            onShowCrosshairChange={setShowCrosshair}
            volumeMode={volumeMode}
            onVolumeModeChange={(mode) => {
              if (volumeModeProp === undefined) setInternalVolumeMode(mode)
            }}
            isoThreshold={isoThreshold}
            onIsoThresholdChange={(value) => {
              if (isoThresholdProp === undefined) setInternalThreshold(value)
            }}
            clipEnabled={clipEnabled}
            onClipEnabledChange={setClipEnabled}
            portalContainer={portalContainer}
          />
        ) : null}
      </div>
    </div>
  )
}

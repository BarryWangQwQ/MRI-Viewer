import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Axis, DisplayParams, MaskOverlay, Volume, VoxelCursor } from '../types'
import { axisToDim, ORIENT_LABELS, planeSize, sliceCount } from '../render/planes'
import { planeToVoxel, voxelToPlane } from '../render/slice'
import { paintSlice } from '../render/paintSlice'
import { cn } from '@/lib/utils'

/** Colour each anatomical plane is identified by, shared with the MPR layout. */
export const AXIS_COLOR: Record<Axis, string> = {
  axial: '#3b82f6',
  coronal: '#ef4444',
  sagittal: '#22c55e',
}

/**
 * Which plane each crosshair line represents. Moving along a view's width axis
 * changes where the *other* views cut, so the lines are coloured after those
 * views rather than after the one they are drawn in.
 */
const CROSSHAIR_AXES: Record<Axis, { vertical: Axis; horizontal: Axis }> = {
  axial: { vertical: 'sagittal', horizontal: 'coronal' },
  coronal: { vertical: 'sagittal', horizontal: 'axial' },
  sagittal: { vertical: 'coronal', horizontal: 'axial' },
}

const MIN_ZOOM = 0.4
const MAX_ZOOM = 12

export interface SliceCanvasProps {
  volume: Volume
  axis: Axis
  index: number
  display: DisplayParams
  overlays?: MaskOverlay[]
  crosshair?: VoxelCursor
  showCrosshair?: boolean
  onIndexChange?: (index: number) => void
  onDisplayChange?: (display: DisplayParams) => void
  onVoxelClick?: (voxel: VoxelCursor) => void
  label?: string
  /** Corner slice readout. Off when the chrome slice bar already shows it. */
  showIndex?: boolean
  className?: string
}

interface Viewport {
  zoom: number
  panX: number
  panY: number
}

const IDENTITY_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 }

/**
 * A single orthogonal cut, drawn on a 2D canvas.
 *
 * Interactions follow what radiology workstations have trained people to expect:
 * wheel scrolls slices, right-drag adjusts window/level, left-drag pans, and
 * ctrl+wheel zooms. Double-click restores the fit.
 */
export function SliceCanvas({
  volume,
  axis,
  index,
  display,
  overlays,
  crosshair,
  showCrosshair = false,
  onIndexChange,
  onDisplayChange,
  onVoxelClick,
  label,
  showIndex = true,
  className,
}: SliceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef<HTMLCanvasElement | null>(null)

  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [probe, setProbe] = useState<{ voxel: VoxelCursor; value: number } | null>(null)

  const total = sliceCount(volume, axis)
  const clampedIndex = Math.max(0, Math.min(total - 1, Math.round(index)))
  const geometry = useMemo(() => planeSize(volume, axis), [volume, axis])
  const dims = useMemo(
    () => [volume.cols, volume.rows, volume.slices] as [number, number, number],
    [volume.cols, volume.rows, volume.slices],
  )

  // Reset the fit whenever the frame of reference changes; keeping a pan from a
  // previous series would leave the image parked off-screen.
  useEffect(() => setViewport(IDENTITY_VIEWPORT), [volume, axis])

  const image = useMemo(
    () => paintSlice(volume, axis, clampedIndex, display, overlays),
    [volume, axis, clampedIndex, display, overlays],
  )

  /* ── Layout ─────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(container)
    setSize({ width: container.clientWidth, height: container.clientHeight })
    return () => observer.disconnect()
  }, [])

  /**
   * Rectangle the image occupies, letterboxed to its physical aspect so
   * anisotropic voxels are not stretched.
   */
  const fit = useMemo(() => {
    const { width, height } = size
    if (!width || !height) return { x: 0, y: 0, width: 0, height: 0 }

    const padding = 8
    const availableW = Math.max(1, width - padding * 2)
    const availableH = Math.max(1, height - padding * 2)

    let drawW = availableW
    let drawH = drawW / geometry.aspect
    if (drawH > availableH) {
      drawH = availableH
      drawW = drawH * geometry.aspect
    }

    drawW *= viewport.zoom
    drawH *= viewport.zoom

    return {
      x: (width - drawW) / 2 + viewport.panX,
      y: (height - drawH) / 2 + viewport.panY,
      width: drawW,
      height: drawH,
    }
  }, [size, geometry.aspect, viewport])

  /* ── Painting ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    let buffer = bufferRef.current
    if (!buffer) {
      buffer = document.createElement('canvas')
      bufferRef.current = buffer
    }
    buffer.width = image.width
    buffer.height = image.height
    buffer.getContext('2d')?.putImageData(image, 0, 0)
  }, [image])

  useEffect(() => {
    const canvas = canvasRef.current
    const buffer = bufferRef.current
    if (!canvas || !buffer || !size.width || !size.height) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)

    if (fit.width > 0 && fit.height > 0) {
      // Only smooth when shrinking. Magnified medical images should show their
      // real sampling rather than an interpolated guess at detail.
      ctx.imageSmoothingEnabled = fit.width < image.width
      ctx.drawImage(buffer, fit.x, fit.y, fit.width, fit.height)
    }

    if (showCrosshair && crosshair) {
      const dim = axisToDim(axis)
      const { w, h } = voxelToPlane(dims, dim, [crosshair.x, crosshair.y, crosshair.z])
      const px = fit.x + ((w + 0.5) / image.width) * fit.width
      const py = fit.y + ((h + 0.5) / image.height) * fit.height
      const lines = CROSSHAIR_AXES[axis]

      ctx.save()
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.75

      ctx.strokeStyle = AXIS_COLOR[lines.vertical]
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, size.height)
      ctx.stroke()

      ctx.strokeStyle = AXIS_COLOR[lines.horizontal]
      ctx.beginPath()
      ctx.moveTo(0, py)
      ctx.lineTo(size.width, py)
      ctx.stroke()
      ctx.restore()
    }
  }, [image, fit, size, showCrosshair, crosshair, axis, dims])

  /* ── Pointer mapping ────────────────────────────────────────────────────── */

  const toVoxel = useCallback(
    (clientX: number, clientY: number): VoxelCursor | null => {
      const canvas = canvasRef.current
      if (!canvas || fit.width <= 0) return null
      const rect = canvas.getBoundingClientRect()
      const u = (clientX - rect.left - fit.x) / fit.width
      const v = (clientY - rect.top - fit.y) / fit.height
      if (u < 0 || u > 1 || v < 0 || v > 1) return null

      const w = Math.min(image.width - 1, Math.floor(u * image.width))
      const h = Math.min(image.height - 1, Math.floor(v * image.height))
      const [x, y, z] = planeToVoxel(dims, axisToDim(axis), clampedIndex, w, h)
      return { x, y, z }
    },
    [fit, image.width, image.height, dims, axis, clampedIndex],
  )

  const dragRef = useRef<{
    mode: 'pan' | 'window'
    startX: number
    startY: number
    origin: Viewport
    display: DisplayParams
    moved: boolean
  } | null>(null)

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.button !== 2) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      mode: event.button === 2 ? 'window' : 'pan',
      startX: event.clientX,
      startY: event.clientY,
      origin: viewport,
      display,
      moved: false,
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const voxel = toVoxel(event.clientX, event.clientY)
    if (voxel) {
      const at = voxel.x + voxel.y * volume.cols + voxel.z * volume.cols * volume.rows
      setProbe({ voxel, value: volume.data[at] })
    } else {
      setProbe(null)
    }

    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
    if (!drag.moved) return

    if (drag.mode === 'pan') {
      setViewport({ ...drag.origin, panX: drag.origin.panX + dx, panY: drag.origin.panY + dy })
      return
    }

    if (!onDisplayChange) return
    // Scale the gesture to the data range so the same drag feels the same on a
    // CT in Hounsfield units and on arbitrary MR intensities.
    const range = Math.max(1, volume.max - volume.min)
    onDisplayChange({
      ...drag.display,
      windowCenter: drag.display.windowCenter + (dy / 200) * range,
      windowWidth: Math.max(1, drag.display.windowWidth + (dx / 200) * range),
    })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!drag || drag.moved || drag.mode !== 'pan') return

    const voxel = toVoxel(event.clientX, event.clientY)
    if (voxel) onVoxelClick?.(voxel)
  }

  const indexRef = useRef(clampedIndex)
  indexRef.current = clampedIndex
  const totalRef = useRef(total)
  totalRef.current = total
  const sizeRef = useRef(size)
  sizeRef.current = size
  const onIndexChangeRef = useRef(onIndexChange)
  onIndexChangeRef.current = onIndexChange

  // Native, non-passive listener: React 19 delegates `onWheel` as passive, so
  // `preventDefault` there cannot stop the host page from scrolling.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY / 400)
        const { width, height } = sizeRef.current
        setViewport((current) => {
          const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom * factor))
          const ratio = zoom / current.zoom
          const canvas = canvasRef.current
          if (!canvas) return { ...current, zoom }
          const rect = canvas.getBoundingClientRect()
          const cx = event.clientX - rect.left - width / 2
          const cy = event.clientY - rect.top - height / 2
          return {
            zoom,
            panX: cx - (cx - current.panX) * ratio,
            panY: cy - (cy - current.panY) * ratio,
          }
        })
        return
      }

      const change = onIndexChangeRef.current
      if (!change) return
      const step = event.deltaY > 0 ? 1 : -1
      const current = indexRef.current
      change(Math.max(0, Math.min(totalRef.current - 1, current + step)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const [left, right, top, bottom] = ORIENT_LABELS[axis]

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative min-h-0 min-w-0 flex-1 overflow-hidden overscroll-contain bg-[var(--viewer-canvas)] select-none',
        className,
      )}
      style={{ touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ cursor: dragRef.current?.mode === 'window' ? 'ns-resize' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setProbe(null)}
        onDoubleClick={() => setViewport(IDENTITY_VIEWPORT)}
        onContextMenu={(event) => event.preventDefault()}
      />

      {/* Orientation letters, in the fixed radiological positions. */}
      <div className="pointer-events-none absolute inset-0 font-mono text-[10px] tracking-wider text-[var(--viewer-canvas-foreground)]/70">
        <span className="absolute top-1/2 left-1 -translate-y-1/2">{left}</span>
        <span className="absolute top-1/2 right-1 -translate-y-1/2">{right}</span>
        <span className="absolute top-1 left-1/2 -translate-x-1/2">{top}</span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2">{bottom}</span>
      </div>

      <div className="pointer-events-none absolute top-1 left-1 flex items-center gap-1.5">
        {label ? (
          <span
            className="font-mono text-[10px] font-medium tracking-wide uppercase"
            style={{ color: AXIS_COLOR[axis] }}
          >
            {label}
          </span>
        ) : null}
      </div>

      {showIndex || probe ? (
        <div className="pointer-events-none absolute right-1 bottom-1 font-mono text-[10px] text-[var(--viewer-canvas-foreground)]/70">
          {showIndex ? `${clampedIndex + 1} / ${total}` : ''}
          {showIndex && probe ? '  ·  ' : ''}
          {probe ? probe.value.toFixed(probe.value % 1 === 0 ? 0 : 1) : ''}
        </div>
      ) : null}

      {viewport.zoom !== 1 ? (
        <div className="pointer-events-none absolute bottom-1 left-1 font-mono text-[10px] text-[var(--viewer-canvas-foreground)]/70">
          {Math.round(viewport.zoom * 100)}%
        </div>
      ) : null}
    </div>
  )
}

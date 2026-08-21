import { useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { Axis, DisplayParams, MaskOverlay, Volume, VoxelCursor } from '../types'
import { SliceCanvas } from './SliceCanvas'
import { VolumeView } from './VolumeView'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type PanelId = Axis | 'volume'

const PANELS: PanelId[] = ['coronal', 'sagittal', 'axial', 'volume']

const PANEL_LABELS: Record<PanelId, string> = {
  coronal: 'Coronal',
  sagittal: 'Sagittal',
  axial: 'Axial',
  volume: '3D',
}

export interface MultiAxisViewProps {
  volume: Volume
  cursor: VoxelCursor
  display: DisplayParams
  overlays?: MaskOverlay[]
  onCursorChange: (cursor: VoxelCursor) => void
  onDisplayChange?: (display: DisplayParams) => void
  showCrosshair?: boolean
  volumeMode?: 'gpu' | 'mesh'
  isoThreshold?: number
  clipEnabled?: boolean
  clipAxis?: Axis
  className?: string
}

/**
 * Linked multiplanar reconstruction: the three orthogonal cuts plus a 3D panel.
 *
 * A single voxel cursor drives all four panels, so clicking anywhere moves the
 * other two cuts to intersect that point — the interaction that makes MPR useful
 * for following a structure across planes.
 */
export function MultiAxisView({
  volume,
  cursor,
  display,
  overlays,
  onCursorChange,
  onDisplayChange,
  showCrosshair = true,
  volumeMode,
  isoThreshold,
  clipEnabled = true,
  clipAxis = 'axial',
  className,
}: MultiAxisViewProps) {
  const [maximized, setMaximized] = useState<PanelId | null>(null)

  const indexFor = (axis: Axis) => (axis === 'axial' ? cursor.z : axis === 'coronal' ? cursor.y : cursor.x)

  const setIndexFor = (axis: Axis, index: number) => {
    if (axis === 'axial') onCursorChange({ ...cursor, z: index })
    else if (axis === 'coronal') onCursorChange({ ...cursor, y: index })
    else onCursorChange({ ...cursor, x: index })
  }

  const visible = maximized ? [maximized] : PANELS

  return (
    <div
      className={cn(
        'grid min-h-0 min-w-0 flex-1 gap-px overflow-hidden overscroll-contain bg-border',
        maximized ? 'grid-cols-1 grid-rows-1' : 'grid-cols-2 grid-rows-2',
        className,
      )}
    >
      {visible.map((panel) => (
        <div key={panel} className="group/panel relative flex min-h-0 min-w-0">
          {panel === 'volume' ? (
            <VolumeView
              volume={volume}
              overlays={overlays}
              display={display}
              mode={volumeMode}
              isoThreshold={isoThreshold}
              clipEnabled={clipEnabled}
              clipAxis={clipAxis}
              clipIndex={indexFor(clipAxis)}
            />
          ) : (
            <SliceCanvas
              volume={volume}
              axis={panel}
              index={indexFor(panel)}
              display={display}
              overlays={overlays}
              crosshair={cursor}
              showCrosshair={showCrosshair}
              label={PANEL_LABELS[panel]}
              onIndexChange={(index) => setIndexFor(panel, index)}
              onDisplayChange={onDisplayChange}
              onVoxelClick={onCursorChange}
            />
          )}

          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={maximized ? `Restore ${PANEL_LABELS[panel]} panel` : `Maximise ${PANEL_LABELS[panel]} panel`}
            className="absolute top-0.5 right-0.5 opacity-0 transition-opacity group-hover/panel:opacity-100 focus-visible:opacity-100"
            onClick={() => setMaximized(maximized ? null : panel)}
          >
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      ))}
    </div>
  )
}

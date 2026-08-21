import { useEffect, useRef } from 'react'
import { FolderOpen, RotateCcw } from 'lucide-react'
import type { Axis, Layout, Volume } from '../types'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

const LAYOUTS: Array<{ value: Layout; label: string }> = [
  { value: 'slice', label: '2D' },
  { value: 'mpr', label: 'MPR' },
  { value: 'volume', label: '3D' },
]

const AXES: Array<{ value: Axis; label: string }> = [
  { value: 'axial', label: 'Ax' },
  { value: 'coronal', label: 'Cor' },
  { value: 'sagittal', label: 'Sag' },
]

export interface ViewerToolbarProps {
  volume: Volume | null
  layout: Layout
  onLayoutChange: (layout: Layout) => void
  axis: Axis
  onAxisChange: (axis: Axis) => void
  onOpenFiles: (files: File[]) => void
  onReset: () => void
  showPicker: boolean
}

export function ViewerToolbar({
  volume,
  layout,
  onLayoutChange,
  axis,
  onAxisChange,
  onOpenFiles,
  onReset,
  showPicker,
}: ViewerToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // `webkitdirectory` is not in React's prop types, and it is the only way to let
  // a user pick a whole DICOM series in one gesture.
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length) onOpenFiles(files)
  }

  return (
    <ScrollArea className="w-full shrink-0 overscroll-contain border-b border-border">
      <div className="flex w-max min-w-full items-center gap-2 px-2 py-1.5">
      <ToggleGroup
        type="single"
        size="sm"
        value={layout}
        onValueChange={(value) => value && onLayoutChange(value as Layout)}
        aria-label="Layout"
      >
        {LAYOUTS.map(({ value, label }) => (
          <ToggleGroupItem key={value} value={value}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {volume ? (
        <>
          <Separator orientation="vertical" className="h-4" />
          <ToggleGroup
            type="single"
            size="sm"
            value={axis}
            onValueChange={(value) => value && onAxisChange(value as Axis)}
            aria-label="Cut plane"
          >
            {AXES.map(({ value, label }) => (
              <ToggleGroupItem key={value} value={value}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </>
      ) : null}

      <Button variant="ghost" size="icon-sm" onClick={onReset} aria-label="Reset view" title="Reset view">
        <RotateCcw />
      </Button>

      <div className="ml-auto flex items-center gap-2">
        {volume ? (
          <span className="font-mono text-xs text-muted-foreground">
            {volume.cols}×{volume.rows}×{volume.slices}
          </span>
        ) : null}

        {showPicker ? (
          <>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <FolderOpen />
              Open
            </Button>
            <Button variant="ghost" size="sm" onClick={() => folderInputRef.current?.click()}>
              Folder
            </Button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={handlePick} />
            <input ref={folderInputRef} type="file" multiple hidden onChange={handlePick} />
          </>
        ) : null}
      </div>
      </div>
    </ScrollArea>
  )
}

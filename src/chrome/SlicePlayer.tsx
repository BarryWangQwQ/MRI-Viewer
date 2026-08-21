import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'

export interface SlicePlayerProps {
  index: number
  total: number
  playing: boolean
  onIndexChange: (index: number) => void
  onPlayingChange: (playing: boolean) => void
  label?: string
}

/**
 * Slice scrubber with cine playback. Space, the play button, and the arrows
 * all drive the same index the 2D canvas and the 3D clip plane already share.
 */
export function SlicePlayer({
  index,
  total,
  playing,
  onIndexChange,
  onPlayingChange,
  label = 'Slice',
}: SlicePlayerProps) {
  const last = Math.max(0, total - 1)
  const current = Math.min(last, Math.max(0, index))

  const step = (delta: number) => {
    const next = Math.min(last, Math.max(0, current + delta))
    if (next === current) return
    onIndexChange(next)
  }

  const togglePlay = () => {
    if (playing) {
      onPlayingChange(false)
      return
    }
    if (current >= last) onIndexChange(0)
    onPlayingChange(true)
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border px-2 py-1.5">
      <Label className="shrink-0 text-xs text-muted-foreground">{label}</Label>

      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous slice"
        title="Previous slice"
        disabled={current <= 0}
        onClick={() => {
          onPlayingChange(false)
          step(-1)
        }}
      >
        <ChevronLeft />
      </Button>

      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={playing ? 'Pause' : 'Play slices'}
        title={playing ? 'Pause (Space)' : 'Play slices (Space)'}
        aria-pressed={playing}
        className={playing ? 'text-primary' : undefined}
        disabled={total <= 1}
        onClick={togglePlay}
      >
        {playing ? <Pause /> : <Play />}
      </Button>

      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next slice"
        title="Next slice"
        disabled={current >= last}
        onClick={() => {
          onPlayingChange(false)
          step(1)
        }}
      >
        <ChevronRight />
      </Button>

      <Slider
        className="flex-1"
        value={[current]}
        min={0}
        max={last}
        step={1}
        onValueChange={([value]) => {
          onPlayingChange(false)
          onIndexChange(value)
        }}
      />

      <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {current + 1} / {total}
      </span>
    </div>
  )
}

import { useMemo, type ReactNode } from 'react'
import { Crosshair } from 'lucide-react'
import type { DisplayParams, Layout, MaskOverlay, Volume } from '../types'
import { DEFAULT_COLORMAP } from '../render/overlay'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface Preset {
  id: string
  label: string
  /** Absolute window in stored units, for modalities where that is meaningful. */
  absolute?: [center: number, width: number]
  /** Fraction of the volume's full intensity range, centred on its midpoint. */
  relative?: number
}

/**
 * Hounsfield presets only make sense for CT, where stored values are calibrated.
 * For MR the stored intensities are arbitrary, so the presets are expressed as a
 * fraction of the volume's own range instead.
 */
const CT_PRESETS: Preset[] = [
  { id: 'ct-brain', label: 'CT brain', absolute: [40, 80] },
  { id: 'ct-soft', label: 'CT soft tissue', absolute: [50, 400] },
  { id: 'ct-bone', label: 'CT bone', absolute: [400, 1800] },
  { id: 'ct-lung', label: 'CT lung', absolute: [-600, 1500] },
]

const RELATIVE_PRESETS: Preset[] = [
  { id: 'full', label: 'Full range', relative: 1 },
  { id: 'contrast', label: 'High contrast', relative: 0.5 },
  { id: 'flat', label: 'Low contrast', relative: 1.6 },
]

export interface ControlPanelProps {
  volume: Volume
  display: DisplayParams
  onDisplayChange: (display: DisplayParams) => void
  layout: Layout
  overlays: MaskOverlay[]
  hiddenOverlays: ReadonlySet<string>
  onToggleOverlay: (id: string, visible: boolean) => void
  maskOpacity: number
  onMaskOpacityChange: (opacity: number) => void
  showCrosshair: boolean
  onShowCrosshairChange: (show: boolean) => void
  volumeMode: 'gpu' | 'mesh'
  onVolumeModeChange: (mode: 'gpu' | 'mesh') => void
  isoThreshold: number
  onIsoThresholdChange: (value: number) => void
  clipEnabled: boolean
  onClipEnabledChange: (enabled: boolean) => void
  portalContainer: HTMLElement | null
}

export function ControlPanel({
  volume,
  display,
  onDisplayChange,
  layout,
  overlays,
  hiddenOverlays,
  onToggleOverlay,
  maskOpacity,
  onMaskOpacityChange,
  showCrosshair,
  onShowCrosshairChange,
  volumeMode,
  onVolumeModeChange,
  isoThreshold,
  onIsoThresholdChange,
  clipEnabled,
  onClipEnabledChange,
  portalContainer,
}: ControlPanelProps) {
  const range = volume.max - volume.min || 1
  const midpoint = (volume.min + volume.max) / 2

  const presets = useMemo<Preset[]>(() => {
    const header: Preset = { id: 'header', label: 'From header', absolute: [volume.windowCenter, volume.windowWidth] }
    return volume.modality === 'CT'
      ? [header, ...CT_PRESETS, ...RELATIVE_PRESETS]
      : [header, ...RELATIVE_PRESETS]
  }, [volume.modality, volume.windowCenter, volume.windowWidth])

  const resolvePreset = (preset: Preset): [number, number] =>
    preset.absolute ?? [midpoint, range * (preset.relative ?? 1)]

  const activePreset = useMemo(() => {
    const match = presets.find((preset) => {
      const [center, width] = resolvePreset(preset)
      return Math.abs(center - display.windowCenter) < range * 0.005 && Math.abs(width - display.windowWidth) < range * 0.005
    })
    return match?.id ?? 'custom'
  }, [presets, display.windowCenter, display.windowWidth, range])

  const visibleOverlays = overlays.length
  const showSurface = layout !== 'slice'

  return (
    <TooltipProvider delayDuration={200}>
      <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col border-l border-border bg-background">
        <ScrollArea className="h-full overscroll-contain">
          <div className="p-3">
            <Accordion type="multiple" defaultValue={['window', 'masks', 'surface']}>
              <AccordionItem value="window">
                <AccordionTrigger>Window</AccordionTrigger>
                <AccordionContent>
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel>Preset</FieldLabel>
                      <Select
                        value={activePreset}
                        onValueChange={(id) => {
                          const preset = presets.find((entry) => entry.id === id)
                          if (!preset) return
                          const [center, width] = resolvePreset(preset)
                          onDisplayChange({ ...display, windowCenter: center, windowWidth: Math.max(1, width) })
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Preset" />
                        </SelectTrigger>
                        <SelectContent container={portalContainer}>
                          {activePreset === 'custom' ? (
                            <SelectItem value="custom" disabled>
                              Custom
                            </SelectItem>
                          ) : null}
                          {presets.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <SliderField
                      label="Level"
                      value={display.windowCenter.toFixed(0)}
                      sliderValue={[display.windowCenter]}
                      min={volume.min - range * 0.5}
                      max={volume.max + range * 0.5}
                      step={range / 500}
                      onValueChange={([value]) => onDisplayChange({ ...display, windowCenter: value })}
                    />

                    <SliderField
                      label="Width"
                      value={display.windowWidth.toFixed(0)}
                      sliderValue={[display.windowWidth]}
                      min={1}
                      max={range * 2}
                      step={range / 500}
                      onValueChange={([value]) => onDisplayChange({ ...display, windowWidth: Math.max(1, value) })}
                    />

                    <SliderField
                      label="Gamma"
                      value={display.gamma.toFixed(2)}
                      sliderValue={[display.gamma]}
                      min={0.4}
                      max={2.5}
                      step={0.02}
                      onValueChange={([value]) => onDisplayChange({ ...display, gamma: value })}
                    />

                    <SwitchField
                      id="invert"
                      label="Invert grayscale"
                      checked={display.invert}
                      onCheckedChange={(invert) => onDisplayChange({ ...display, invert })}
                    />

                    {layout === 'mpr' ? (
                      <SwitchField
                        id="crosshair"
                        label="Crosshairs"
                        icon={<Crosshair className="size-3.5" />}
                        checked={showCrosshair}
                        onCheckedChange={onShowCrosshairChange}
                      />
                    ) : null}
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>

              {visibleOverlays ? (
                <AccordionItem value="masks">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      Masks
                      <Badge variant="secondary">{visibleOverlays}</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="h-auto">
                    <FieldGroup className="gap-4">
                      <ItemGroup>
                        {overlays.map((overlay) => {
                          const swatches = legendEntries(overlay)
                          return (
                            <Item key={overlay.id} variant="outline" size="xs">
                              <ItemMedia>
                                <Checkbox
                                  id={`mask-${overlay.id}`}
                                  checked={!hiddenOverlays.has(overlay.id)}
                                  onCheckedChange={(checked) => onToggleOverlay(overlay.id, checked === true)}
                                />
                              </ItemMedia>
                              <ItemContent>
                                <ItemTitle>
                                  <Label htmlFor={`mask-${overlay.id}`}>{overlay.id}</Label>
                                </ItemTitle>
                                <ItemDescription>
                                  {swatches.length} {swatches.length === 1 ? 'region' : 'regions'}
                                </ItemDescription>
                              </ItemContent>
                              <ItemFooter className="w-full min-w-0">
                                <MaskLegend overlay={overlay} swatches={swatches} portalContainer={portalContainer} />
                              </ItemFooter>
                            </Item>
                          )
                        })}
                      </ItemGroup>

                      <FieldSeparator />

                      <SliderField
                        label="Opacity"
                        value={`${Math.round(maskOpacity * 100)}%`}
                        sliderValue={[maskOpacity]}
                        min={0}
                        max={1}
                        step={0.01}
                        onValueChange={([value]) => onMaskOpacityChange(value)}
                      />
                    </FieldGroup>
                  </AccordionContent>
                </AccordionItem>
              ) : null}

              {showSurface ? (
                <AccordionItem value="surface">
                  <AccordionTrigger>Surface</AccordionTrigger>
                  <AccordionContent>
                    <FieldGroup className="gap-4">
                      <Field>
                        <FieldLabel>Renderer</FieldLabel>
                        <Select value={volumeMode} onValueChange={(value) => onVolumeModeChange(value as 'gpu' | 'mesh')}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent container={portalContainer}>
                            <SelectItem value="gpu">GPU ray marching</SelectItem>
                            <SelectItem value="mesh">Marching cubes</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>

                      <SliderField
                        label="Isosurface"
                        value={isoThreshold.toFixed(3)}
                        sliderValue={[isoThreshold]}
                        min={0.01}
                        max={0.99}
                        step={0.005}
                        onValueChange={([value]) => onIsoThresholdChange(value)}
                      />

                      <SwitchField
                        id="clip"
                        label="Clip to slice"
                        checked={clipEnabled}
                        onCheckedChange={onClipEnabledChange}
                      />

                      <FieldDescription>
                        {clipEnabled
                          ? 'The volume is cut open at the current slice so interior masks show on the face.'
                          : volumeMode === 'gpu'
                            ? 'Threshold updates are a shader uniform, so dragging is immediate.'
                            : 'Each threshold change re-extracts the mesh on a worker thread.'}
                      </FieldDescription>
                    </FieldGroup>
                  </AccordionContent>
                </AccordionItem>
              ) : null}
            </Accordion>
          </div>
        </ScrollArea>
      </aside>
    </TooltipProvider>
  )
}

function SliderField({
  label,
  value,
  sliderValue,
  min,
  max,
  step,
  onValueChange,
}: {
  label: string
  value: string
  sliderValue: number[]
  min: number
  max: number
  step: number
  onValueChange: (value: number[]) => void
}) {
  return (
    <Field>
      <FieldLabel className="w-full justify-between">
        {label}
        <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">{value}</span>
      </FieldLabel>
      <Slider value={sliderValue} min={min} max={max} step={step} onValueChange={onValueChange} />
    </Field>
  )
}

function SwitchField({
  id,
  label,
  icon,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  icon?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id}>
        {icon}
        {label}
      </FieldLabel>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </Field>
  )
}

type LegendEntry = {
  id: number
  color: string
  name?: string
}

/**
 * Colour legend for a mask.
 *
 * Lists `colormap` (plus optional `names` on hover). The host should attach
 * those when the overlay is built. Scanning the labelmap here would be a full
 * volume pass on every render.
 */
function legendEntries(overlay: MaskOverlay): LegendEntry[] {
  const entries = Object.entries(overlay.colormap ?? {})
    .map(([id, color]) => {
      const n = Number(id)
      return { id: n, color, name: overlay.names?.[n] }
    })
    .filter((entry) => Number.isFinite(entry.id) && entry.id > 0)
    .sort((a, b) => a.id - b.id)
  return entries.length
    ? entries
    : [{ id: 1, color: DEFAULT_COLORMAP[1], name: overlay.names?.[1] }]
}

function MaskLegend({
  overlay,
  swatches,
  portalContainer,
}: {
  overlay: MaskOverlay
  swatches: LegendEntry[]
  portalContainer: HTMLElement | null
}) {
  return (
    <ScrollArea className="w-full min-w-0 max-h-40 overscroll-contain">
      <div className="flex flex-wrap content-start gap-2 pr-3">
        {swatches.map((entry) => {
          const name = entry.name ? `${entry.id} ${entry.name}` : String(entry.id)
          return (
            <Tooltip key={`${overlay.id}-${entry.id}`}>
              <TooltipTrigger className="inline-flex">
                <Badge variant="outline" className="font-mono">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                  {entry.id}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="left" container={portalContainer}>
                {name}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </ScrollArea>
  )
}

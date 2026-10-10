'use client'

import { Crop as CropIcon, SlidersHorizontal, WandSparkles } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useId } from 'react'

import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { Button } from '@/lib/components/ui/button'
import { Slider } from '@/lib/components/ui/slider'
import { TabsContent, TabsList, TabsTrigger } from '@/lib/components/ui/tabs'
import type { AdjustmentKey } from '@/lib/services/medias/edit/recipe'
import { cn } from '@/lib/utils'

import { CropPanel } from './CropPanel'
import {
  CONTROLS_BY_KEY,
  type ControlGroup,
  GROUP_LABELS,
  PHONE_CATEGORIES,
  controlsIn
} from './adjustmentControls'
import type { EditorControls } from './editorControls'

interface Props {
  controls: EditorControls
  category: ControlGroup
  selected: AdjustmentKey
  onCategoryChange: (category: ControlGroup) => void
  onSelect: (key: AdjustmentKey) => void
  alerts: ReactNode
}

/**
 * The phone controls: a category control with Auto, a row of 58 px chips
 * (a dot marks a changed value), one large slider for the chosen chip, and
 * the Adjust / Crop tab bar. The Crop tab replaces the chip area.
 */
export const EditorPhoneControls = ({
  controls,
  category,
  selected,
  onCategoryChange,
  onSelect,
  alerts
}: Props) => {
  const valueId = useId()
  const { recipe, disabled } = controls
  const chips = controlsIn(category)
  const current =
    CONTROLS_BY_KEY[
      chips.some((c) => c.key === selected) ? selected : chips[0].key
    ]
  const value = recipe.adjustments[current.key] ?? 0

  const onChipKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = chips.findIndex((chip) => chip.key === current.key)
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? chips[(index + 1) % chips.length]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? chips[(index - 1 + chips.length) % chips.length]
          : null
    if (!next) return
    event.preventDefault()
    onSelect(next.key)
    event.currentTarget
      .querySelector<HTMLElement>(`[data-chip="${next.key}"]`)
      ?.focus()
  }

  return (
    <div className="shrink-0 border-t bg-background">
      {alerts ? <div className="p-3 pb-0">{alerts}</div> : null}
      <TabsContent value="adjust" className="space-y-3 pt-3">
        <div className="flex items-center gap-2 px-3">
          <SegmentedControl
            aria-label="Adjustment category"
            size="sm"
            className="min-w-0 flex-1"
            items={PHONE_CATEGORIES.map((group) => ({
              value: group,
              label: GROUP_LABELS[group],
              disabled
            }))}
            value={category}
            onValueChange={(next) => onCategoryChange(next as ControlGroup)}
          />
          <Button
            type="button"
            variant="pill"
            size="sm"
            className="max-md:min-h-10"
            disabled={disabled}
            onClick={controls.onAuto}
          >
            <WandSparkles aria-hidden="true" />
            Auto
          </Button>
        </div>
        {controls.autoStatus ? (
          <p className="px-3 text-xs text-muted-foreground">
            {controls.autoStatus}
          </p>
        ) : null}
        <div
          role="radiogroup"
          aria-label={`${GROUP_LABELS[category]} adjustments`}
          onKeyDown={onChipKeyDown}
          className="flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {chips.map((chip) => {
            const chipValue = recipe.adjustments[chip.key] ?? 0
            const active = chip.key === current.key
            const Icon = chip.icon
            return (
              <button
                key={chip.key}
                type="button"
                role="radio"
                aria-checked={active}
                aria-describedby={`${valueId}-${chip.key}`}
                data-chip={chip.key}
                tabIndex={active ? 0 : -1}
                disabled={disabled}
                onClick={() => onSelect(chip.key)}
                className="flex min-h-10 w-[58px] shrink-0 flex-col items-center gap-1 rounded-lg py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <span
                  className={cn(
                    'relative flex size-[38px] items-center justify-center rounded-full bg-muted',
                    active && 'ring-2 ring-primary'
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn('size-4', chip.flipIcon && 'rotate-180')}
                  />
                  {chipValue !== 0 ? (
                    <span
                      data-testid="changed-dot"
                      aria-hidden="true"
                      className="absolute top-0 right-0 size-1.5 rounded-full bg-primary"
                    />
                  ) : null}
                </span>
                <span className="text-[11px] leading-none">{chip.label}</span>
                <span id={`${valueId}-${chip.key}`} className="sr-only">
                  {chip.speak(chipValue)}
                </span>
              </button>
            )
          })}
        </div>
        <div
          className="space-y-1 px-4 pb-3"
          onPointerDownCapture={() => controls.onGestureStart(current.key)}
        >
          <div className="flex items-baseline justify-between text-sm">
            <span>{current.label}</span>
            <span
              className={cn(
                'tabular-nums',
                value !== 0
                  ? 'font-semibold text-primary-text'
                  : 'text-muted-foreground'
              )}
            >
              {current.format(value)}
            </span>
          </div>
          <Slider
            label={current.label}
            value={value}
            min={current.min}
            max={current.max}
            step={current.step}
            bipolar
            disabled={disabled}
            formatValue={current.speak}
            onValueChange={(next) => controls.onAdjust(current.key, next)}
            onValueCommit={controls.onGestureEnd}
          />
        </div>
      </TabsContent>
      <TabsContent value="crop">
        <CropPanel controls={controls} compact />
      </TabsContent>
      <TabsList className="h-[58px] w-full rounded-none border-t bg-background p-0">
        <TabsTrigger
          value="adjust"
          className="h-full flex-col gap-0.5 rounded-none border-0 text-[11px] data-[state=active]:bg-transparent data-[state=active]:text-primary-text data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
        >
          <SlidersHorizontal aria-hidden="true" />
          Adjust
        </TabsTrigger>
        <TabsTrigger
          value="crop"
          className="h-full flex-col gap-0.5 rounded-none border-0 text-[11px] data-[state=active]:bg-transparent data-[state=active]:text-primary-text data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
        >
          <CropIcon aria-hidden="true" />
          Crop
        </TabsTrigger>
      </TabsList>
    </div>
  )
}

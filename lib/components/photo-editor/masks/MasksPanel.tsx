'use client'

import { X } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'

import { AdjustmentRow } from '@/lib/components/photo-editor/AdjustmentRow'
import {
  type ControlGroup,
  MASK_CONTROLS,
  maskControlsIn
} from '@/lib/components/photo-editor/adjustmentControls'
import { Button } from '@/lib/components/ui/button'
import { Slider } from '@/lib/components/ui/slider'
import {
  type Recipe,
  countChangedAdjustments
} from '@/lib/services/medias/edit/recipe'
import { cn } from '@/lib/utils'

import {
  MaskAddButtons,
  MaskModelStatus,
  MaskRefineControls
} from './MaskParts'
import { MaskThumb } from './MaskThumb'
import { MASK_COPY } from './maskCopy'
import { getRasters } from './maskRaster'
import { DEFAULT_FEATHER, describeMask, getMaskName } from './maskRecipe'
import type { MaskTools } from './useMasks'

const RESET_CLASS = 'h-6 px-2 text-xs'

interface Props {
  recipe: Recipe
  tools: MaskTools
  disabled: boolean
  onGestureStart: (key: string) => void
  onGestureEnd: () => void
}

/**
 * The desktop Masks tab: the mask list, the three ways to add a mask, refine
 * controls, feather, and the selected mask's own sliders.
 */
export const MasksPanel = ({
  recipe,
  tools,
  disabled,
  onGestureStart,
  onGestureEnd
}: Props) => {
  const [detailOpen, setDetailOpen] = useState(false)
  const { selected } = tools
  const rasters = getRasters(recipe)

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const ids = tools.masks.map((mask) => mask.id)
    const index = ids.indexOf(tools.selectedId ?? '')
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? ids[(index + 1) % ids.length]
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? ids[(index - 1 + ids.length) % ids.length]
          : null
    if (!next) return
    event.preventDefault()
    tools.select(next)
    event.currentTarget
      .querySelector<HTMLElement>(`[data-mask-row="${next}"]`)
      ?.focus()
  }

  const rows = (groups: ControlGroup[]) =>
    selected
      ? maskControlsIn(...groups).map((control) => {
          const key = control.key as keyof typeof selected.adjustments
          const gestureKey = `${selected.id}:${control.key}`
          return (
            <AdjustmentRow
              key={`${selected.id}:${control.key}`}
              control={control}
              value={selected.adjustments[key] ?? 0}
              disabled={disabled}
              onChange={(value) => tools.adjust(key, value)}
              onGestureStart={() => onGestureStart(gestureKey)}
              onGestureEnd={onGestureEnd}
            />
          )
        })
      : null

  const changed = selected
    ? countChangedAdjustments(selected.adjustments) > 0
    : false
  const name = selected ? getMaskName(recipe, selected.id) : ''

  return (
    <div className="space-y-5 p-4">
      <MaskModelStatus tools={tools} />

      {tools.masks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tools.canSelectSubject ? MASK_COPY.empty : MASK_COPY.emptyBrushOnly}
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Masks"
          onKeyDown={onListKeyDown}
          className="grid gap-1.5"
        >
          {tools.masks.map((mask) => {
            const active = mask.id === tools.selectedId
            const maskName = getMaskName(recipe, mask.id)
            return (
              <div
                key={mask.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border p-1.5 pl-2',
                  active && 'border-primary bg-primary/10 dark:bg-primary/15'
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-mask-row={mask.id}
                  tabIndex={active ? 0 : -1}
                  onClick={() => tools.select(mask.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <MaskThumb
                    raster={
                      (mask.kind === 'background'
                        ? mask.of && rasters[mask.of]
                        : rasters[mask.id]) || null
                    }
                    inverse={mask.kind === 'background'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold">
                      {maskName}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {describeMask(recipe, mask)}
                    </span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  aria-label={`${MASK_COPY.remove_mask}: ${maskName}`}
                  onClick={() => tools.remove(mask.id)}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      <MaskAddButtons tools={tools} disabled={disabled} />

      {selected ? (
        <>
          <section className="space-y-3" aria-label={`Refine ${name}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {MASK_COPY.refine} {name.toLowerCase()}
              </h3>
            </div>
            <MaskRefineControls tools={tools} disabled={disabled} />
            <div
              className="space-y-1"
              onPointerDownCapture={() =>
                onGestureStart(`${selected.id}:feather`)
              }
            >
              <div className="flex items-baseline justify-between text-sm">
                <span>{MASK_COPY.feather}</span>
                <span
                  className={cn(
                    'tabular-nums',
                    selected.feather !== DEFAULT_FEATHER
                      ? 'font-semibold text-primary-text'
                      : 'text-muted-foreground'
                  )}
                >
                  {selected.feather}
                </span>
              </div>
              <Slider
                label={MASK_COPY.feather}
                value={selected.feather}
                min={0}
                max={100}
                step={1}
                disabled={disabled}
                defaultValue={DEFAULT_FEATHER}
                formatValue={(value) => `${value}`}
                onValueChange={tools.setFeather}
                onValueCommit={onGestureEnd}
              />
            </div>
          </section>

          <section className="space-y-3" aria-label={`${name} adjustments`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {name} adjustments
              </h3>
              {changed ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={RESET_CLASS}
                  aria-label={`Reset ${name} adjustments`}
                  onClick={() =>
                    tools.resetAdjustments(
                      MASK_CONTROLS.map(
                        (control) =>
                          control.key as keyof typeof selected.adjustments
                      )
                    )
                  }
                >
                  Reset
                </Button>
              ) : null}
            </div>
            {rows(['light', 'colour'])}
            <div className="flex items-center justify-between pt-1">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Detail
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={RESET_CLASS}
                aria-expanded={detailOpen}
                onClick={() => setDetailOpen((open) => !open)}
              >
                {detailOpen ? 'Hide' : 'Show'}
              </Button>
            </div>
            {detailOpen ? rows(['detail']) : null}
          </section>
        </>
      ) : null}
    </div>
  )
}

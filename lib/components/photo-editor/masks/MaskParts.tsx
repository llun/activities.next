'use client'

import { Brush, Contrast, Loader2, Minus, Plus } from 'lucide-react'

import { PillGroup } from '@/lib/components/photo-editor/PillGroup'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import { Progress } from '@/lib/components/ui/progress'
import { Slider } from '@/lib/components/ui/slider'
import { cn } from '@/lib/utils'

import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from './brushRaster'
import { MASK_COPY } from './maskCopy'
import { formatModelSize } from './modelCache'
import type { MaskTools, RefineMode } from './useMasks'

/** The model download, its preparation, and a failure of either. */
export const MaskModelStatus = ({ tools }: { tools: MaskTools }) => {
  const { sam } = tools
  if (sam.phase === 'downloading') {
    const percent =
      sam.totalBytes > 0
        ? Math.min(100, Math.round((sam.loadedBytes / sam.totalBytes) * 100))
        : 0
    return (
      <div role="status" className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {MASK_COPY.downloading(formatModelSize(sam.totalBytes))}
        </p>
        <Progress
          value={percent}
          aria-label="Subject model download"
          aria-valuetext={`${percent}%`}
        />
      </div>
    )
  }
  if (sam.phase === 'preparing') {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {MASK_COPY.preparing}
      </p>
    )
  }
  if (sam.phase === 'error') return <Alert title={sam.message} />
  return null
}

/** Select subject, Background and Brush: the three ways to start a mask. */
export const MaskAddButtons = ({
  tools,
  disabled,
  className
}: {
  tools: MaskTools
  disabled: boolean
  className?: string
}) => {
  const blocked = disabled || tools.atLimit
  const hasSubject = tools.masks.some((mask) => mask.kind === 'subject')
  return (
    <div className="space-y-2">
      <div className={cn('flex flex-wrap gap-1.5', className)}>
        {tools.canSelectSubject ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-md:min-h-10"
            disabled={blocked || tools.working}
            onClick={() => void tools.selectSubject()}
          >
            <Plus aria-hidden="true" />
            {MASK_COPY.selectSubject}
          </Button>
        ) : null}
        {tools.canSelectSubject || hasSubject ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-md:min-h-10"
            disabled={blocked || !tools.canAddBackground}
            onClick={tools.addBackground}
          >
            <Contrast aria-hidden="true" />
            {MASK_COPY.background}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-md:min-h-10"
          disabled={blocked}
          onClick={tools.addBrush}
        >
          <Brush aria-hidden="true" />
          {MASK_COPY.brush}
        </Button>
      </div>
      {tools.atLimit ? (
        <p className="text-xs text-muted-foreground">{MASK_COPY.limit}</p>
      ) : !hasSubject && tools.canSelectSubject ? (
        <p className="text-xs text-muted-foreground">{MASK_COPY.needSubject}</p>
      ) : null}
    </div>
  )
}

const MODES: ReadonlyArray<{
  value: RefineMode
  label: string
  Icon: typeof Plus
}> = [
  { value: 'add', label: MASK_COPY.add, Icon: Plus },
  { value: 'remove', label: MASK_COPY.remove, Icon: Minus },
  { value: 'brush', label: MASK_COPY.brush, Icon: Brush }
]

/** Add / Remove / Brush for the selected mask, and the brush's own controls. */
export const MaskRefineControls = ({
  tools,
  disabled
}: {
  tools: MaskTools
  disabled: boolean
}) => {
  const { selected } = tools
  if (!selected) return null
  if (selected.kind === 'background') {
    return (
      <p className="text-xs text-muted-foreground">
        {MASK_COPY.backgroundFollows}
      </p>
    )
  }
  const taps = selected.kind === 'subject' && tools.canSelectSubject
  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Refine mode"
        className="grid grid-cols-3 gap-1.5"
      >
        {MODES.map(({ value, label, Icon }) => {
          const active = tools.mode === value
          const unavailable = value !== 'brush' && !taps
          return (
            <Button
              key={value}
              type="button"
              role="radio"
              variant="outline"
              aria-checked={active}
              data-state={active ? 'checked' : 'unchecked'}
              disabled={disabled || unavailable}
              onClick={() => tools.setMode(value)}
              className={cn(
                'h-auto flex-col gap-0.5 px-1 py-1.5 text-[11.5px] max-md:min-h-10',
                active &&
                  'border-primary bg-primary/10 font-semibold text-primary-text hover:bg-primary/15 dark:border-primary dark:bg-primary/15'
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Button>
          )
        })}
      </div>
      {selected.kind === 'subject' && !tools.canSelectSubject ? (
        <p className="text-xs text-muted-foreground">{MASK_COPY.subjectOff}</p>
      ) : null}
      {tools.mode === 'brush' ? (
        <div className="space-y-3">
          <PillGroup
            aria-label="Brush action"
            items={[
              { value: 'paint', label: MASK_COPY.brushPaint },
              { value: 'erase', label: MASK_COPY.brushErase }
            ]}
            value={tools.brushErase ? 'erase' : 'paint'}
            disabled={disabled}
            onValueChange={(next) => tools.setBrushErase(next === 'erase')}
          />
          <div className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span>{MASK_COPY.brushSize}</span>
              <span className="text-muted-foreground tabular-nums">
                {tools.brushSize} px
              </span>
            </div>
            <Slider
              label={MASK_COPY.brushSize}
              value={tools.brushSize}
              min={MIN_BRUSH_SIZE}
              max={MAX_BRUSH_SIZE}
              step={1}
              disabled={disabled}
              defaultValue={40}
              formatValue={(value) => `${value} pixels`}
              onValueChange={tools.setBrushSize}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

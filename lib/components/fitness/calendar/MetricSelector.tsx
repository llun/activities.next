'use client'

import { KeyboardEvent, useRef } from 'react'

import { HEAT_METRICS, HeatMetric } from '@/lib/fitness/calendar/heatLevels'
import { cn } from '@/lib/utils'

const METRIC_LABELS: Record<HeatMetric, string> = {
  count: 'Activities',
  distance: 'Distance',
  duration: 'Duration'
}

export interface MetricSelectorProps {
  value: HeatMetric
  onChange: (metric: HeatMetric) => void
  disabled?: boolean
  className?: string
}

/**
 * Which number the cells are shaded by: Activities, Distance or Duration. It
 * changes the shading and the legend and nothing else (not the range, not the
 * summary, not the selection).
 *
 * A radio group, so a screen reader announces "Distance, radio button, 2 of 3"
 * and the arrow keys move and choose; one tab stop. The segments are 44px tall
 * on every pointer, and orange marks the active one (orange = interaction;
 * the green in the cells is intensity only).
 */
export const MetricSelector = ({
  value,
  onChange,
  disabled = false,
  className
}: MetricSelectorProps) => {
  const group = useRef<HTMLDivElement>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0 || disabled) return
    event.preventDefault()
    const index = HEAT_METRICS.indexOf(value)
    const next =
      HEAT_METRICS[(index + step + HEAT_METRICS.length) % HEAT_METRICS.length]
    onChange(next)
    // The roving tab stop moves with the choice; focus follows it.
    group.current
      ?.querySelector<HTMLElement>(`[data-metric="${next}"]`)
      ?.focus()
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="Shade the calendar by"
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        'bg-muted border-border flex h-11 w-full items-stretch gap-0.5 rounded-lg border p-1 @min-[40rem]:inline-flex @min-[40rem]:w-auto',
        disabled && 'opacity-50',
        className
      )}
    >
      {HEAT_METRICS.map((metric) => {
        const active = metric === value
        return (
          <button
            key={metric}
            type="button"
            role="radio"
            aria-checked={active}
            data-metric={metric}
            disabled={disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(metric)}
            className={cn(
              // The segment is 36px tall inside a 44px track; the pseudo
              // element extends the hit area to the track's full height.
              'relative flex flex-1 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none before:absolute before:-inset-y-1 before:inset-x-0 before:content-[""] focus-visible:ring-[3px] focus-visible:ring-offset-1 @min-[40rem]:flex-none',
              'focus-visible:ring-ring/50 disabled:cursor-default',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-accent'
            )}
          >
            {METRIC_LABELS[metric]}
          </button>
        )
      })}
    </div>
  )
}

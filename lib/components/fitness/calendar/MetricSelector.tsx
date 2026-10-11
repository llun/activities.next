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
 * and the arrow keys move and choose; one tab stop. The track's 4px padding
 * (`p-1`) creates equal 4px empty space around the 36px (`min-h-9`) segment
 * items on top, bottom, left, and right, producing a 44px total height.
 * Concentric rounded-md corners nest inside the track's rounded-lg border.
 * Orange marks the active one (orange = interaction; the green in the cells
 * is intensity only).
 *
 * It wraps instead of clipping: at 200% text three segments no longer fit one
 * row of a phone, so they flow onto further rows (one segment each at 390px)
 * and stay inside the container and reachable.
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
        'bg-muted flex min-h-11 w-full flex-wrap p-1 gap-1 items-center rounded-lg shadow-[inset_0_0_0_1px_var(--border)] @min-[40rem]:inline-flex @min-[40rem]:w-auto',
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
              // 36px tall (`min-h-9 py-1.5`); the track's 4px padding (`p-1`)
              // creates equal 4px empty space on top, bottom, left, and right.
              'flex min-h-9 flex-[1_1_auto] cursor-pointer items-center justify-center rounded-md py-1.5 px-4 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default @min-[40rem]:flex-none',
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

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
 * and the arrow keys move and choose; one tab stop. Each segment IS 44px tall
 * (the element itself, not a pseudo-element, so a measurement of the control
 * agrees with what a finger can hit); the visible pill is inset 4px inside it
 * by a transparent border, so the track still reads as a 36px pill on a 44px
 * track. Orange marks the active one (orange = interaction; the green in the
 * cells is intensity only).
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
        'bg-muted flex min-h-11 w-full flex-wrap items-stretch gap-0.5 rounded-lg shadow-[inset_0_0_0_1px_var(--border)] @min-[40rem]:inline-flex @min-[40rem]:w-auto',
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
              // 44px tall; the transparent border insets the painted pill (and
              // the clipped background) to 36px, 1px from the track's sides.
              'flex min-h-11 flex-[1_1_auto] cursor-pointer items-center justify-center rounded-lg border-x border-y-4 border-transparent bg-clip-padding px-4 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-offset-1 @min-[40rem]:flex-none',
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

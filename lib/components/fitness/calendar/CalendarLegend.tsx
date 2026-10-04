import { HeatMetric, legendFor } from '@/lib/fitness/calendar/heatLevels'
import { cn } from '@/lib/utils'

import styles from './calendar.module.css'

const METRIC_NAMES: Record<HeatMetric, string> = {
  count: 'activities per day',
  distance: 'distance per day',
  duration: 'duration per day'
}

export interface CalendarLegendProps {
  metric: HeatMetric
  /**
   * Add the "Upcoming" swatch. Only month view of the current month has
   * upcoming days; the annual grid ends at today.
   */
  showUpcoming?: boolean
  className?: string
}

/**
 * What the greens mean. The scale is fixed (never relative to the visible
 * range): count is exactly 0, 1, 2, 3 and 4+, and distance and duration show
 * their thresholds with units (<10 km … 50+ km, <30m … 2h+).
 *
 * Wraps cleanly: five equal swatches on one row where the container allows
 * (container query, not the viewport), else a three-column grid that breaks
 * into two even rows instead of stranding one swatch.
 */
export const CalendarLegend = ({
  metric,
  showUpcoming = false,
  className
}: CalendarLegendProps) => (
  <ul
    aria-label={`Legend: ${METRIC_NAMES[metric]}`}
    data-metric={metric}
    className={cn(
      'fitness-heat text-muted-foreground m-0 grid list-none grid-cols-3 gap-x-4 gap-y-2 p-0 text-[13px] @min-[28rem]:flex @min-[28rem]:flex-wrap @min-[28rem]:items-center @min-[28rem]:gap-x-3.5 @min-[28rem]:gap-y-1.5',
      className
    )}
  >
    {legendFor(metric).map((entry) => (
      <li
        key={entry.level}
        data-level={entry.level}
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <span
          aria-hidden="true"
          data-level={entry.level}
          className={styles.swatch}
        />
        {entry.label}
      </li>
    ))}
    {showUpcoming && (
      <li
        data-upcoming="true"
        className="border-border inline-flex items-center gap-1.5 whitespace-nowrap @min-[28rem]:border-l @min-[28rem]:pl-3.5"
      >
        <span
          aria-hidden="true"
          data-upcoming="true"
          className={styles.swatch}
        />
        Upcoming
      </li>
    )}
  </ul>
)

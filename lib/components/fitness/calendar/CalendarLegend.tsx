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
 * Wraps cleanly: a flex row that breaks at item boundaries, so it is one row
 * where everything fits (count with or without "Upcoming" at 390px) and never
 * more than two on a phone, two at 320px even with the distance or duration
 * thresholds and "Upcoming" (the design's M16 breaks the same way, four then
 * one). The divider before "Upcoming" is for the wide, one-row case only: at a
 * wrap it would sit at the start of a row.
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
      'fitness-heat text-muted-foreground m-0 flex list-none flex-wrap items-center gap-x-3.5 gap-y-1.5 p-0 text-[13px]',
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

import { Activity, Clock, LucideIcon, MapPin, Mountain } from 'lucide-react'
import { FC } from 'react'

import { FitnessStatGrid } from '@/lib/components/fitness/FitnessStatGrid'
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatInteger
} from '@/lib/fitness/calendar/format'
import type { FitnessActivitySummary } from '@/lib/fitness/calendar/types'
import { cn } from '@/lib/utils'

export interface SummaryTotals {
  count: number
  totalDistanceMeters: number
  totalDurationSeconds: number
  totalElevationGainMeters: number
}

/** The range's totals over every activity-type row, untyped included. */
export const summaryTotals = (
  summary: readonly FitnessActivitySummary[]
): SummaryTotals =>
  summary.reduce<SummaryTotals>(
    (acc, item) => ({
      count: acc.count + item.count,
      totalDistanceMeters: acc.totalDistanceMeters + item.totalDistanceMeters,
      totalDurationSeconds:
        acc.totalDurationSeconds + item.totalDurationSeconds,
      totalElevationGainMeters:
        acc.totalElevationGainMeters + item.totalElevationGainMeters
    }),
    {
      count: 0,
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      totalElevationGainMeters: 0
    }
  )

interface Stat {
  label: string
  icon: LucideIcon
  value: (totals: SummaryTotals) => string
}

const STATS: readonly Stat[] = [
  {
    label: 'Activities',
    icon: Activity,
    value: (totals) => formatInteger(totals.count)
  },
  {
    label: 'Distance',
    icon: MapPin,
    value: (totals) => formatDistance(totals.totalDistanceMeters)
  },
  {
    label: 'Duration',
    icon: Clock,
    value: (totals) => formatDuration(totals.totalDurationSeconds)
  },
  {
    label: 'Elevation',
    icon: Mountain,
    value: (totals) => formatElevation(totals.totalElevationGainMeters)
  }
]

interface Props {
  /**
   * The totals to show. `null` while there is nothing to show yet: with
   * `loading` the values are skeletons, otherwise (a failed first read) they
   * are dashes, never zeros, because no data is not the same as no activity.
   */
  totals: SummaryTotals | null
  loading?: boolean
  className?: string
}

/**
 * Activities, Distance, Duration and Elevation for the applied range, on the
 * shared `FitnessStatGrid` (`summary` variant): four across only where the
 * container is wide enough for every value on one line, 2×2 otherwise, and one
 * column at large text sizes. A value is never clipped: if its cell is ever too
 * narrow it breaks inside the cell rather than overflowing it.
 */
export const FitnessSummaryStrip: FC<Props> = ({
  totals,
  loading = false,
  className
}) => (
  <FitnessStatGrid variant="summary" className={className}>
    {STATS.map(({ label, icon: Icon, value }) => (
      <div
        key={label}
        className="bg-background flex min-w-0 items-center gap-3 px-4 py-3"
      >
        {/* Four across there is room for the icon; in the 2×2 card (a phone)
            the value needs the whole cell, as in the designs. The skeleton is
            a STATIC block (`--skeleton`), never the shared shimmering
            `.skeleton`: loading is a 0.6 dim and still bars, no motion. */}
        <Icon
          className="text-muted-foreground hidden size-5 shrink-0 @min-[43.75rem]:block"
          aria-hidden="true"
        />
        <dl className="flex min-w-0 flex-col-reverse">
          <dt className="text-muted-foreground text-sm">{label}</dt>
          <dd
            className={cn(
              'text-xl font-semibold tabular-nums break-words',
              loading && 'text-transparent'
            )}
          >
            {loading ? (
              <>
                <span className="sr-only">Loading</span>
                <span
                  aria-hidden="true"
                  className="my-1 block h-5 w-20 rounded bg-(--skeleton)"
                />
              </>
            ) : totals === null ? (
              <>
                <span aria-hidden="true">–</span>
                <span className="sr-only">Unavailable</span>
              </>
            ) : (
              value(totals)
            )}
          </dd>
        </dl>
      </div>
    ))}
  </FitnessStatGrid>
)

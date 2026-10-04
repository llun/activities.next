'use client'

import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns/format'
import { FC } from 'react'

import { useHasHydrated } from '@/lib/hooks/useHasHydrated'

const ACTIVITY_START_PATTERN = 'p, MMMM d, yyyy'

interface Props {
  timestamp: number
}

/**
 * When the activity started, in the viewer's own time zone — the zone the
 * fitness training calendar buckets days in, so a 23:30 run is dated the same
 * day on both. The server does not know that zone and renders UTC; hydration
 * repeats that text and the local one replaces it straight after, so there is
 * no hydration mismatch.
 */
export const ActivityStartTime: FC<Props> = ({ timestamp }) => {
  const hasHydrated = useHasHydrated()
  const date = hasHydrated ? new Date(timestamp) : new UTCDate(timestamp)

  return (
    <time dateTime={new Date(timestamp).toISOString()}>
      {format(date, ACTIVITY_START_PATTERN)}
    </time>
  )
}

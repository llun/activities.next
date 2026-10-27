'use client'

import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns/format'
import { FC } from 'react'

import { useHasHydrated } from '@/lib/hooks/useHasHydrated'

const MOVING_DATE_PATTERN = 'd MMM yyyy'

/**
 * A cooldown or migration date as "23 Nov 2026". The server cannot know the
 * viewer's zone: UTC until hydration, then local (the PolicyDate pattern).
 */
export const MovingDate: FC<{ at: string | number }> = ({ at }) => {
  const hasHydrated = useHasHydrated()
  return (
    <time dateTime={new Date(at).toISOString()}>
      {format(
        hasHydrated ? new Date(at) : new UTCDate(at),
        MOVING_DATE_PATTERN
      )}
    </time>
  )
}

'use client'

import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns/format'
import { FC } from 'react'

import { useHasHydrated } from '@/lib/hooks/useHasHydrated'

const POLICY_DATE_PATTERN = 'd MMM yyyy'

/**
 * A terms or privacy "last updated" date, as "12 Oct 2026". The server cannot
 * know the viewer's zone: UTC until hydration, then local.
 */
export const PolicyDate: FC<{ at: number }> = ({ at }) => {
  const hasHydrated = useHasHydrated()
  return (
    <time dateTime={new Date(at).toISOString()}>
      {format(
        hasHydrated ? new Date(at) : new UTCDate(at),
        POLICY_DATE_PATTERN
      )}
    </time>
  )
}

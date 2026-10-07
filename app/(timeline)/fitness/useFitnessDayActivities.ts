'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { getFitnessCalendarDayActivities } from '@/lib/client'
import type { FitnessDayActivity } from '@/lib/fitness/calendar/types'
import { isAbortError } from '@/lib/utils/isAbortError'

/** Rows per page of a day's activities. */
export const DAY_ACTIVITIES_PAGE_SIZE = 20

export interface DayActivities {
  /** Rows loaded so far for the selected day, in order. */
  activities: readonly FitnessDayActivity[]
  /** The first page for the selected day is in flight. */
  loading: boolean
  /** A further page is in flight. */
  loadingMore: boolean
  /** The latest request for this day failed; loaded rows stay. */
  error: boolean
  hasMore: boolean
  loadMore: () => void
  /** Re-issues whichever request failed: the first page or the next one. */
  retry: () => void
  /** Re-reads the selected day from its first page, failed or not. */
  reload: () => void
}

interface DayPage {
  /** The day this page belongs to: actor, zone, date and attempt. */
  key: string
  activities: FitnessDayActivity[]
  hasMore: boolean
  nextOffset: number
  error: boolean
}

interface MoreState {
  key: string
  loading: boolean
  error: boolean
}

const appendUnique = (
  existing: readonly FitnessDayActivity[],
  next: readonly FitnessDayActivity[]
) => {
  const seen = new Set(existing.map((activity) => activity.id))
  return [...existing, ...next.filter((activity) => !seen.has(activity.id))]
}

/**
 * The activities behind one selected calendar day, a page at a time.
 *
 * Selecting a day reads its first page; another day aborts the read in flight
 * and only the latest request may commit (a request id, so a response the
 * transport failed to abort is still dropped). "Load more" appends the next
 * page while the day is unchanged. A failure stays with the day: the loaded
 * rows are kept and `retry` re-issues exactly the request that failed. Nothing
 * here touches the range or the totals; the day's totals come from the
 * calendar bucket the caller already holds.
 */
export const useFitnessDayActivities = ({
  actorId,
  date,
  timeZone
}: {
  actorId: string
  /** The selected day, or `null` when none is selected. */
  date: string | null
  timeZone: string
}): DayActivities => {
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState<DayPage | null>(null)
  const [more, setMore] = useState<MoreState | null>(null)
  const requestId = useRef(0)
  const inFlight = useRef<AbortController | null>(null)

  const key =
    date === null ? null : [actorId, timeZone, date, attempt].join('\u0000')

  useEffect(() => {
    // A further page belongs to the first page it extends. Re-selecting a day
    // reproduces its key, so a further page that was aborted or failed before
    // would otherwise still read as loading (a disabled Load more) or as
    // failed (a Retry that fetches the next page, not this first one).
    setMore(null)
    if (date === null) {
      // Deselecting abandons whatever was loading.
      ++requestId.current
      inFlight.current?.abort()
      inFlight.current = null
      return
    }
    const id = ++requestId.current
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    const requestKey = [actorId, timeZone, date, attempt].join('\u0000')
    getFitnessCalendarDayActivities({
      actorId,
      date,
      timeZone,
      limit: DAY_ACTIVITIES_PAGE_SIZE,
      signal: controller.signal
    }).then(
      (result) => {
        if (id !== requestId.current) return
        setPage({
          key: requestKey,
          activities: result.activities,
          hasMore: result.hasMore,
          nextOffset: result.nextOffset,
          error: false
        })
      },
      (error: unknown) => {
        if (id !== requestId.current || isAbortError(error)) return
        setPage({
          key: requestKey,
          activities: [],
          hasMore: false,
          nextOffset: 0,
          error: true
        })
      }
    )
    return () => controller.abort()
  }, [actorId, timeZone, date, attempt])

  useEffect(() => () => inFlight.current?.abort(), [])

  const current = key !== null && page?.key === key ? page : null
  const currentMore = key !== null && more?.key === key ? more : null

  const loadMore = useCallback(() => {
    if (
      date === null ||
      current === null ||
      current.error ||
      !current.hasMore ||
      currentMore?.loading
    ) {
      return
    }
    const pageKey = current.key
    const id = ++requestId.current
    const controller = new AbortController()
    inFlight.current = controller
    setMore({ key: pageKey, loading: true, error: false })
    getFitnessCalendarDayActivities({
      actorId,
      date,
      timeZone,
      limit: DAY_ACTIVITIES_PAGE_SIZE,
      offset: current.nextOffset,
      signal: controller.signal
    }).then(
      (result) => {
        if (id !== requestId.current) return
        setPage((previous) =>
          previous?.key === pageKey
            ? {
                ...previous,
                activities: appendUnique(
                  previous.activities,
                  result.activities
                ),
                hasMore: result.hasMore,
                nextOffset: result.nextOffset
              }
            : previous
        )
        setMore(null)
      },
      (error: unknown) => {
        if (id !== requestId.current || isAbortError(error)) return
        setMore({ key: pageKey, loading: false, error: true })
      }
    )
  }, [actorId, timeZone, date, current, currentMore])

  const retry = useCallback(() => {
    if (currentMore?.error) {
      loadMore()
      return
    }
    setAttempt((value) => value + 1)
  }, [currentMore, loadMore])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return {
    activities: current?.activities ?? [],
    loading: key !== null && current === null,
    loadingMore: currentMore?.loading ?? false,
    error: (current?.error ?? false) || (currentMore?.error ?? false),
    hasMore: current?.hasMore ?? false,
    loadMore,
    retry,
    reload
  }
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { getFitnessCalendarData, getFitnessSummary } from '@/lib/client'
import type { AppliedRange } from '@/lib/fitness/calendar/ranges'
import type {
  FitnessActivitySummary,
  FitnessCalendarDay
} from '@/lib/fitness/calendar/types'
import { isAbortError } from '@/lib/utils/isAbortError'

/** One committed read: the summary and the calendar for the same range. */
export interface OverviewResult {
  range: AppliedRange
  summary: FitnessActivitySummary[]
  days: FitnessCalendarDay[]
}

export type OverviewDataStatus = 'loading' | 'success' | 'error'

export interface OverviewData {
  /**
   * `loading` while the read for the requested range is in flight, `success`
   * once it committed, `error` when it failed.
   */
  status: OverviewDataStatus
  /**
   * The last read that committed, for whatever range it was. It equals the
   * requested range on `success`; while loading or after an error it is the
   * previous range's, which the UI must label as such and never show under
   * the new dates.
   */
  result: OverviewResult | null
  /** Re-issues the read for the requested range. */
  retry: () => void
}

interface Settled {
  /** The request this settles: range, zone, actor and attempt. */
  key: string
  ok: boolean
}

// The kind is part of the request: on 1-20 January "This month" and "Year to
// date" are the same days but different views, and the committed result names
// the view it was read for. One builder for the render's key and the effect's,
// which must match exactly for a settled read to leave `loading`.
const requestKeyOf = (
  actorId: string,
  timeZone: string,
  kind: AppliedRange['kind'],
  from: string,
  to: string,
  attempt: number
) => [actorId, timeZone, kind, from, to, attempt].join('\u0000')

/**
 * Reads the overview's summary and calendar for one range, together.
 *
 * - Both reads commit in one state update or neither does (`Promise.all`), so
 *   the totals and the grid can never describe different ranges.
 * - A new range aborts the read in flight, and a monotonically increasing
 *   request id means only the latest request may commit: a slow first
 *   response that lands after a faster second one is dropped even if the
 *   transport ignored the abort.
 * - An abort is never an error. An HTTP or network failure keeps the last
 *   committed result (labelled by the caller) and reports `error`; it never
 *   commits an empty result.
 *
 * The status is derived from which request last settled, so it reads
 * `loading` in the same render that asks for a new range.
 */
export const useFitnessOverviewData = ({
  actorId,
  range,
  timeZone
}: {
  actorId: string
  range: AppliedRange
  timeZone: string
}): OverviewData => {
  const { kind, from, to } = range
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<OverviewResult | null>(null)
  const [settled, setSettled] = useState<Settled | null>(null)
  const requestId = useRef(0)

  const key = requestKeyOf(actorId, timeZone, kind, from, to, attempt)

  useEffect(() => {
    const id = ++requestId.current
    const controller = new AbortController()
    const { signal } = controller
    const requestKey = requestKeyOf(actorId, timeZone, kind, from, to, attempt)
    Promise.all([
      getFitnessSummary({ actorId, from, to, timeZone, signal }),
      getFitnessCalendarData({ actorId, from, to, timeZone, signal })
    ]).then(
      ([summary, days]) => {
        if (id !== requestId.current || signal.aborted) return
        setResult({ range: { kind, from, to }, summary, days })
        setSettled({ key: requestKey, ok: true })
      },
      (error: unknown) => {
        if (id !== requestId.current || signal.aborted) return
        // The other read has no use any more.
        controller.abort()
        if (isAbortError(error)) return
        // The banner shows fixed copy, never the reason, so none is kept.
        setSettled({ key: requestKey, ok: false })
      }
    )
    return () => controller.abort()
  }, [actorId, timeZone, kind, from, to, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  const current = settled?.key === key ? settled : null
  return {
    status: current === null ? 'loading' : current.ok ? 'success' : 'error',
    result,
    retry
  }
}

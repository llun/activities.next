/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'

import {
  ApiRequestError,
  getFitnessCalendarData,
  getFitnessSummary
} from '@/lib/client'
import { DateKey } from '@/lib/fitness/calendar/localDay'
import { AppliedRange } from '@/lib/fitness/calendar/ranges'
import type {
  FitnessActivitySummary,
  FitnessCalendarDay
} from '@/lib/fitness/calendar/types'
import { createDeferred } from '@/lib/testing/deferred'

import { useFitnessOverviewData } from './useFitnessOverviewData'

vi.mock('@/lib/client', async () => {
  const http =
    await vi.importActual<typeof import('@/lib/client/http')>(
      '@/lib/client/http'
    )
  return {
    ApiRequestError: http.ApiRequestError,
    getFitnessSummary: vi.fn(),
    getFitnessCalendarData: vi.fn()
  }
})

const mockedSummary = vi.mocked(getFitnessSummary)
const mockedCalendar = vi.mocked(getFitnessCalendarData)

const ACTOR_ID = 'https://activities.local/users/llun'
const TIME_ZONE = 'Europe/Amsterdam'

const range = (from: string, to: string, kind: AppliedRange['kind'] = 'ytd') =>
  ({ kind, from: from as DateKey, to: to as DateKey }) as AppliedRange

const YTD = range('2026-01-01', '2026-10-04')
const SEPTEMBER = range('2026-09-01', '2026-09-30', 'month')

const summaryRow = (count: number): FitnessActivitySummary => ({
  activityType: 'run',
  count,
  totalDistanceMeters: count * 5000,
  totalDurationSeconds: count * 1800,
  totalElevationGainMeters: count * 10
})

const calendarDay = (date: string, count = 1): FitnessCalendarDay => ({
  date,
  count,
  totalDistanceMeters: 5000,
  totalDurationSeconds: 1800,
  totalElevationGainMeters: 10
})

const renderData = (initial: AppliedRange) =>
  renderHook(
    ({ applied }) =>
      useFitnessOverviewData({
        actorId: ACTOR_ID,
        range: applied,
        timeZone: TIME_ZONE
      }),
    { initialProps: { applied: initial } }
  )

describe('useFitnessOverviewData', () => {
  beforeEach(() => {
    mockedSummary.mockReset()
    mockedCalendar.mockReset()
  })

  it('reads the summary and the calendar for the range in the viewer zone', async () => {
    mockedSummary.mockResolvedValue([summaryRow(3)])
    mockedCalendar.mockResolvedValue([calendarDay('2026-09-24')])

    const { result } = renderData(YTD)

    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('success'))
    const expected = {
      actorId: ACTOR_ID,
      from: '2026-01-01',
      to: '2026-10-04',
      timeZone: TIME_ZONE,
      signal: expect.any(AbortSignal)
    }
    expect(mockedSummary).toHaveBeenCalledWith(expected)
    expect(mockedCalendar).toHaveBeenCalledWith(expected)
    expect(result.current.result).toEqual({
      range: YTD,
      summary: [summaryRow(3)],
      days: [calendarDay('2026-09-24')]
    })
  })

  it('commits the summary and the calendar together or not at all', async () => {
    const summary = createDeferred<FitnessActivitySummary[]>()
    const calendar = createDeferred<FitnessCalendarDay[]>()
    mockedSummary.mockReturnValue(summary.promise)
    mockedCalendar.mockReturnValue(calendar.promise)

    const { result } = renderData(YTD)

    // One half alone never shows: totals without their grid would describe a
    // range the calendar does not.
    await act(async () => summary.resolve([summaryRow(3)]))
    expect(result.current.status).toBe('loading')
    expect(result.current.result).toBeNull()

    await act(async () => calendar.reject(new ApiRequestError('Boom', 500)))
    expect(result.current.status).toBe('error')
    expect(result.current.result).toBeNull()
    expect(result.current.error).toBe('Boom')
  })

  it('ignores a response that lands after a newer request', async () => {
    const first = {
      summary: createDeferred<FitnessActivitySummary[]>(),
      calendar: createDeferred<FitnessCalendarDay[]>()
    }
    const second = {
      summary: createDeferred<FitnessActivitySummary[]>(),
      calendar: createDeferred<FitnessCalendarDay[]>()
    }
    mockedSummary
      .mockReturnValueOnce(first.summary.promise)
      .mockReturnValueOnce(second.summary.promise)
    mockedCalendar
      .mockReturnValueOnce(first.calendar.promise)
      .mockReturnValueOnce(second.calendar.promise)

    const { result, rerender } = renderData(YTD)
    rerender({ applied: SEPTEMBER })

    await act(async () => {
      second.summary.resolve([summaryRow(2)])
      second.calendar.resolve([calendarDay('2026-09-24', 2)])
    })
    expect(result.current.result?.range).toEqual(SEPTEMBER)

    // The transport is mocked and ignores the abort, so the hook itself has
    // to drop the first response rather than let it overwrite the second.
    await act(async () => {
      first.summary.resolve([summaryRow(9)])
      first.calendar.resolve([calendarDay('2026-03-01', 9)])
    })
    expect(result.current.status).toBe('success')
    expect(result.current.result).toEqual({
      range: SEPTEMBER,
      summary: [summaryRow(2)],
      days: [calendarDay('2026-09-24', 2)]
    })
  })

  it('aborts the read in flight when the range changes', async () => {
    mockedSummary.mockReturnValue(new Promise(() => {}))
    mockedCalendar.mockReturnValue(new Promise(() => {}))

    const { rerender } = renderData(YTD)
    const firstSignal = mockedSummary.mock.calls[0][0].signal
    const firstCalendarSignal = mockedCalendar.mock.calls[0][0].signal
    expect(firstSignal?.aborted).toBe(false)

    rerender({ applied: SEPTEMBER })

    expect(firstSignal?.aborted).toBe(true)
    expect(firstCalendarSignal?.aborted).toBe(true)
    expect(mockedSummary.mock.calls[1][0].signal?.aborted).toBe(false)
  })

  it('never reports an abort as an error', async () => {
    const abort = new DOMException('The user aborted a request.', 'AbortError')
    mockedSummary.mockRejectedValueOnce(abort)
    mockedCalendar.mockRejectedValueOnce(abort)

    const { result } = renderData(YTD)
    await act(async () => {})

    expect(result.current.status).toBe('loading')
    expect(result.current.error).toBeNull()
  })

  it('keeps the previous result after a failure and retries the same range', async () => {
    mockedSummary.mockResolvedValueOnce([summaryRow(3)])
    mockedCalendar.mockResolvedValueOnce([calendarDay('2026-09-24')])
    const { result, rerender } = renderData(YTD)
    await waitFor(() => expect(result.current.status).toBe('success'))

    mockedSummary.mockRejectedValueOnce(
      new ApiRequestError('Service Unavailable', 503)
    )
    mockedCalendar.mockResolvedValueOnce([])
    rerender({ applied: SEPTEMBER })
    await waitFor(() => expect(result.current.status).toBe('error'))

    // An HTTP failure is not an empty range: the last good read stays, under
    // its own range, for the caller to label.
    expect(result.current.result?.range).toEqual(YTD)
    expect(result.current.result?.summary).toEqual([summaryRow(3)])
    expect(result.current.error).toBe('Service Unavailable')

    mockedSummary.mockResolvedValueOnce([summaryRow(1)])
    mockedCalendar.mockResolvedValueOnce([calendarDay('2026-09-02')])
    act(() => result.current.retry())
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('success'))

    expect(mockedSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-09-01', to: '2026-09-30' })
    )
    expect(result.current.result?.range).toEqual(SEPTEMBER)
  })
})

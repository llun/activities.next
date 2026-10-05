/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'

import { getFitnessCalendarDayActivities } from '@/lib/client'
import type {
  FitnessDayActivitiesPage,
  FitnessDayActivity
} from '@/lib/fitness/calendar/types'
import { createDeferred } from '@/lib/testing/deferred'

import {
  DAY_ACTIVITIES_PAGE_SIZE,
  useFitnessDayActivities
} from './useFitnessDayActivities'

vi.mock('@/lib/client', () => ({
  getFitnessCalendarDayActivities: vi.fn()
}))

const mockedDay = vi.mocked(getFitnessCalendarDayActivities)

const ACTOR_ID = 'https://activities.local/users/llun'
const TIME_ZONE = 'America/Los_Angeles'

const activity = (id: string): FitnessDayActivity => ({
  id,
  activityType: 'run',
  startTime: Date.UTC(2026, 8, 24, 14),
  totalDistanceMeters: 5000,
  totalDurationSeconds: 1800,
  elevationGainMeters: 12,
  title: `Run ${id}`,
  statusPath: `/@llun/${id}`
})

const page = (
  date: string,
  ids: string[],
  hasMore = false,
  nextOffset = ids.length
): FitnessDayActivitiesPage => ({
  date,
  timeZone: TIME_ZONE,
  activities: ids.map(activity),
  hasMore,
  nextOffset
})

const renderDay = (date: string | null) =>
  renderHook(
    ({ selected }) =>
      useFitnessDayActivities({
        actorId: ACTOR_ID,
        date: selected,
        timeZone: TIME_ZONE
      }),
    { initialProps: { selected: date } }
  )

const ids = (activities: readonly FitnessDayActivity[]) =>
  activities.map((item) => item.id)

describe('useFitnessDayActivities', () => {
  beforeEach(() => {
    mockedDay.mockReset()
  })

  it('reads nothing while no day is selected', () => {
    const { result } = renderDay(null)

    expect(mockedDay).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({
      activities: [],
      loading: false,
      error: false
    })
  })

  it('loads the first page of the selected day in the viewer zone', async () => {
    mockedDay.mockResolvedValueOnce(page('2026-09-24', ['a', 'b']))

    const { result } = renderDay('2026-09-24')

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockedDay).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      date: '2026-09-24',
      timeZone: TIME_ZONE,
      limit: DAY_ACTIVITIES_PAGE_SIZE,
      signal: expect.any(AbortSignal)
    })
    expect(ids(result.current.activities)).toEqual(['a', 'b'])
  })

  it('appends the next page from the previous page offset', async () => {
    mockedDay
      .mockResolvedValueOnce(page('2026-09-24', ['a', 'b'], true, 2))
      .mockResolvedValueOnce(page('2026-09-24', ['b', 'c'], false, 4))

    const { result } = renderDay('2026-09-24')
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    act(() => result.current.loadMore())
    expect(result.current.loadingMore).toBe(true)
    await waitFor(() => expect(result.current.loadingMore).toBe(false))

    expect(mockedDay).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 2, date: '2026-09-24' })
    )
    // A row that shifted across the page boundary is not listed twice.
    expect(ids(result.current.activities)).toEqual(['a', 'b', 'c'])
    expect(result.current.hasMore).toBe(false)
  })

  it('aborts the previous day and ignores its late response', async () => {
    const first = createDeferred<FitnessDayActivitiesPage>()
    const second = createDeferred<FitnessDayActivitiesPage>()
    mockedDay
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const { result, rerender } = renderDay('2026-09-24')
    const firstSignal = mockedDay.mock.calls[0][0].signal
    rerender({ selected: '2026-09-25' })
    expect(firstSignal?.aborted).toBe(true)

    await act(async () => second.resolve(page('2026-09-25', ['late-day'])))
    await act(async () => first.resolve(page('2026-09-24', ['stale'])))

    expect(ids(result.current.activities)).toEqual(['late-day'])
  })

  it('keeps the day on a failure and retries the first page', async () => {
    mockedDay
      .mockRejectedValueOnce(new Error('Service Unavailable'))
      .mockResolvedValueOnce(page('2026-09-24', ['a']))

    const { result } = renderDay('2026-09-24')
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.loading).toBe(false)

    act(() => result.current.retry())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockedDay).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: '2026-09-24' })
    )
    expect(result.current.error).toBe(false)
    expect(ids(result.current.activities)).toEqual(['a'])
  })

  it('keeps the loaded rows when a further page fails, and retries that page', async () => {
    mockedDay
      .mockResolvedValueOnce(page('2026-09-24', ['a'], true, 1))
      .mockRejectedValueOnce(new Error('Gateway Timeout'))
      .mockResolvedValueOnce(page('2026-09-24', ['b'], false, 2))

    const { result } = renderDay('2026-09-24')
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(ids(result.current.activities)).toEqual(['a'])

    act(() => result.current.retry())
    expect(result.current.loadingMore).toBe(true)
    await waitFor(() => expect(result.current.loadingMore).toBe(false))

    expect(mockedDay).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 1 })
    )
    expect(result.current.error).toBe(false)
    expect(ids(result.current.activities)).toEqual(['a', 'b'])
  })

  it('lets Load more run again after a day is left mid-page and selected again', async () => {
    mockedDay.mockImplementation(({ date, offset, signal }) => {
      if (offset) {
        // A further page that only ends when the day is left.
        return new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        )
      }
      return Promise.resolve(page(date, [date], date === '2026-09-24', 1))
    })
    const { result, rerender } = renderDay('2026-09-24')
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    act(() => result.current.loadMore())
    expect(result.current.loadingMore).toBe(true)

    rerender({ selected: '2026-09-25' })
    await waitFor(() =>
      expect(ids(result.current.activities)).toEqual(['2026-09-25'])
    )
    rerender({ selected: '2026-09-24' })
    await waitFor(() =>
      expect(ids(result.current.activities)).toEqual(['2026-09-24'])
    )

    expect(result.current.hasMore).toBe(true)
    expect(result.current.loadingMore).toBe(false)
    act(() => result.current.loadMore())
    expect(mockedDay).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: '2026-09-24', offset: 1 })
    )
  })

  it('forgets a failed further page once the day is selected again', async () => {
    mockedDay
      .mockResolvedValueOnce(page('2026-09-24', ['a'], true, 1))
      .mockRejectedValueOnce(new Error('Gateway Timeout'))
      .mockResolvedValueOnce(page('2026-09-25', ['x']))
      .mockResolvedValueOnce(page('2026-09-24', ['a'], true, 1))
    const { result, rerender } = renderDay('2026-09-24')
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.error).toBe(true))

    rerender({ selected: '2026-09-25' })
    await waitFor(() => expect(ids(result.current.activities)).toEqual(['x']))
    rerender({ selected: '2026-09-24' })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe(false)
    expect(ids(result.current.activities)).toEqual(['a'])
  })

  it('does not request another page once the day has no more', async () => {
    mockedDay.mockResolvedValueOnce(page('2026-09-24', ['a'], false, 1))
    const { result } = renderDay('2026-09-24')
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.loadMore())

    expect(mockedDay).toHaveBeenCalledTimes(1)
    expect(result.current.loadingMore).toBe(false)
  })

  it('ignores Load more while a page is already loading', async () => {
    const more = createDeferred<FitnessDayActivitiesPage>()
    mockedDay
      .mockResolvedValueOnce(page('2026-09-24', ['a'], true, 1))
      .mockReturnValueOnce(more.promise)
    const { result } = renderDay('2026-09-24')
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    act(() => result.current.loadMore())
    expect(result.current.loadingMore).toBe(true)
    act(() => result.current.loadMore())

    expect(mockedDay).toHaveBeenCalledTimes(2)
    await act(async () => more.resolve(page('2026-09-24', ['b'], false, 2)))
    expect(ids(result.current.activities)).toEqual(['a', 'b'])
  })

  it('drops a further page that lands after another day was selected', async () => {
    const staleMore = createDeferred<FitnessDayActivitiesPage>()
    const nextDayMore = createDeferred<FitnessDayActivitiesPage>()
    mockedDay
      .mockResolvedValueOnce(page('2026-09-24', ['a'], true, 1))
      .mockReturnValueOnce(staleMore.promise)
      .mockResolvedValueOnce(page('2026-09-25', ['x'], true, 1))
      .mockReturnValueOnce(nextDayMore.promise)
    const { result, rerender } = renderDay('2026-09-24')
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    act(() => result.current.loadMore())

    rerender({ selected: '2026-09-25' })
    await waitFor(() => expect(ids(result.current.activities)).toEqual(['x']))
    act(() => result.current.loadMore())
    expect(result.current.loadingMore).toBe(true)

    // The transport is mocked and ignores the abort, so the hook itself has
    // to drop the first day's page.
    await act(async () =>
      staleMore.resolve(page('2026-09-24', ['stale'], false, 2))
    )

    expect(ids(result.current.activities)).toEqual(['x'])
    expect(result.current.loadingMore).toBe(true)
    expect(result.current.hasMore).toBe(true)
  })

  it('aborts a further page when the day is deselected', async () => {
    const more = createDeferred<FitnessDayActivitiesPage>()
    mockedDay
      .mockResolvedValueOnce(page('2026-09-24', ['a'], true, 1))
      .mockReturnValueOnce(more.promise)
    const { result, rerender } = renderDay('2026-09-24')
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    act(() => result.current.loadMore())
    const moreSignal = mockedDay.mock.calls[1][0].signal
    expect(moreSignal?.aborted).toBe(false)

    rerender({ selected: null })
    expect(moreSignal?.aborted).toBe(true)
    expect(result.current.activities).toEqual([])
  })

  it('aborts a further page when unmounted', async () => {
    mockedDay
      .mockResolvedValueOnce(page('2026-09-24', ['a'], true, 1))
      .mockReturnValueOnce(new Promise(() => {}))
    const { result, unmount } = renderDay('2026-09-24')
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    act(() => result.current.loadMore())
    const moreSignal = mockedDay.mock.calls[1][0].signal

    unmount()

    expect(moreSignal?.aborted).toBe(true)
  })
})

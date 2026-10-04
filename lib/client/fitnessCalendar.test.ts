/** @vitest-environment jsdom */
import fetchMock from 'jest-fetch-mock'

import {
  getFitnessCalendarData,
  getFitnessCalendarDayActivities
} from './fitnessCalendar'
import { ApiRequestError } from './http'

const calendarDay = {
  date: '2026-09-01',
  count: 2,
  totalDistanceMeters: 10000,
  totalDurationSeconds: 3600,
  totalElevationGainMeters: 120
}

const dayActivity = {
  id: 'file-1',
  activityType: 'running',
  startTime: 1788250000000,
  totalDistanceMeters: 5000,
  totalDurationSeconds: 1800,
  elevationGainMeters: 40,
  title: 'Morning run',
  statusPath: '/@test-user/status-1'
}

const dayPage = {
  date: '2026-09-01',
  timeZone: 'Asia/Bangkok',
  activities: [dayActivity],
  hasMore: false,
  nextOffset: 1
}

describe('fitnessCalendar client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getFitnessCalendarData', () => {
    it('requests the exact URL and returns the parsed days', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([calendarDay]), {
        status: 200
      })

      const result = await getFitnessCalendarData({
        actorId: 'test-user',
        from: '2026-01-01',
        to: '2026-10-04',
        timeZone: 'Asia/Bangkok'
      })

      expect(result).toEqual([calendarDay])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${window.origin}/api/v1/accounts/test-user/fitness-calendar?from=2026-01-01&to=2026-10-04&time_zone=Asia%2FBangkok`
      )
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })

    it('does not send the removed start_date and end_date params', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

      await getFitnessCalendarData({
        actorId: 'test-user',
        from: '2026-01-01',
        to: '2026-10-04',
        timeZone: 'UTC'
      })

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.has('start_date')).toBe(false)
      expect(url.searchParams.has('end_date')).toBe(false)
    })

    it('appends activity_type after the time zone when provided', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

      await getFitnessCalendarData({
        actorId: 'test-user',
        from: '2026-01-01',
        to: '2026-10-04',
        timeZone: 'America/New_York',
        activityType: 'running'
      })

      expect(fetchMock.mock.calls[0][0]).toBe(
        `${window.origin}/api/v1/accounts/test-user/fitness-calendar?from=2026-01-01&to=2026-10-04&time_zone=America%2FNew_York&activity_type=running`
      )
    })

    it('correctly encodes actorId with special characters or URLs', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

      await getFitnessCalendarData({
        actorId: 'https://example.com/users/alice',
        from: '2026-01-01',
        to: '2026-10-04',
        timeZone: 'UTC'
      })

      // toIdPathSegment converts https://example.com/users/alice to example.com:users:alice
      expect(fetchMock.mock.calls[0][0]).toContain(
        '/api/v1/accounts/example.com:users:alice/fitness-calendar?'
      )
    })

    it('forwards the abort signal to fetch', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })
      const controller = new AbortController()

      await getFitnessCalendarData({
        actorId: 'test-user',
        from: '2026-01-01',
        to: '2026-10-04',
        timeZone: 'UTC',
        signal: controller.signal
      })

      expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
    })

    it('rejects with the abort reason when the request is aborted', async () => {
      const controller = new AbortController()
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
      )

      const request = getFitnessCalendarData({
        actorId: 'test-user',
        from: '2026-01-01',
        to: '2026-10-04',
        timeZone: 'UTC',
        signal: controller.signal
      })
      controller.abort()

      await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    })

    it.each([400, 401, 403, 500])(
      'throws an ApiRequestError with the server message on %i',
      async (status) => {
        fetchMock.mockResponseOnce(
          JSON.stringify({ error: `Server said ${status}` }),
          { status }
        )

        const request = getFitnessCalendarData({
          actorId: 'test-user',
          from: '2026-01-01',
          to: '2026-10-04',
          timeZone: 'UTC'
        })

        await expect(request).rejects.toBeInstanceOf(ApiRequestError)
        await expect(request).rejects.toMatchObject({
          message: `Server said ${status}`,
          status
        })
      }
    )

    it('falls back to a message when the error body is empty', async () => {
      fetchMock.mockResponseOnce('', { status: 500, statusText: '' })

      await expect(
        getFitnessCalendarData({
          actorId: 'test-user',
          from: '2026-01-01',
          to: '2026-10-04',
          timeZone: 'UTC'
        })
      ).rejects.toMatchObject({
        message: 'Failed to fetch fitness calendar.',
        status: 500
      })
    })

    it('throws on a 200 whose body is not an array', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ days: [] }), { status: 200 })

      await expect(
        getFitnessCalendarData({
          actorId: 'test-user',
          from: '2026-01-01',
          to: '2026-10-04',
          timeZone: 'UTC'
        })
      ).rejects.toThrow('Fitness calendar response is invalid')
    })

    it('throws on a 200 whose day is malformed', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify([{ date: '2026-09-01', count: '2' }]),
        { status: 200 }
      )

      await expect(
        getFitnessCalendarData({
          actorId: 'test-user',
          from: '2026-01-01',
          to: '2026-10-04',
          timeZone: 'UTC'
        })
      ).rejects.toThrow('Fitness calendar response is invalid')
    })

    it('throws on a 200 whose body is not JSON', async () => {
      fetchMock.mockResponseOnce('<html>proxy error</html>', { status: 200 })

      await expect(
        getFitnessCalendarData({
          actorId: 'test-user',
          from: '2026-01-01',
          to: '2026-10-04',
          timeZone: 'UTC'
        })
      ).rejects.toThrow('Fitness calendar response is invalid')
    })

    it('never resolves an error response to an empty array', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Server error' }), {
        status: 500
      })

      await expect(
        getFitnessCalendarData({
          actorId: 'test-user',
          from: '2026-01-01',
          to: '2026-10-04',
          timeZone: 'UTC'
        })
      ).rejects.toThrow('Server error')
    })
  })

  describe('getFitnessCalendarDayActivities', () => {
    it('requests the exact URL without paging params by default', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(dayPage), { status: 200 })

      const result = await getFitnessCalendarDayActivities({
        actorId: 'test-user',
        date: '2026-09-01',
        timeZone: 'Asia/Bangkok'
      })

      expect(result).toEqual(dayPage)
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${window.origin}/api/v1/accounts/test-user/fitness-calendar/day?date=2026-09-01&time_zone=Asia%2FBangkok`
      )
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })

    it('appends limit and offset, including an offset of zero', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(dayPage), { status: 200 })

      await getFitnessCalendarDayActivities({
        actorId: 'test-user',
        date: '2026-09-01',
        timeZone: 'UTC',
        limit: 20,
        offset: 0
      })

      expect(fetchMock.mock.calls[0][0]).toBe(
        `${window.origin}/api/v1/accounts/test-user/fitness-calendar/day?date=2026-09-01&time_zone=UTC&limit=20&offset=0`
      )
    })

    it('encodes an AP URI actor id as a path segment', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(dayPage), { status: 200 })

      await getFitnessCalendarDayActivities({
        actorId: 'https://example.com/users/alice',
        date: '2026-09-01',
        timeZone: 'UTC'
      })

      expect(fetchMock.mock.calls[0][0]).toContain(
        '/api/v1/accounts/example.com:users:alice/fitness-calendar/day?'
      )
    })

    it('accepts activities whose optional fields and post are null', async () => {
      const sparse = {
        ...dayPage,
        activities: [
          {
            id: 'file-2',
            activityType: null,
            startTime: 1788250000000,
            totalDistanceMeters: null,
            totalDurationSeconds: null,
            elevationGainMeters: null,
            title: null,
            statusPath: null
          }
        ]
      }
      fetchMock.mockResponseOnce(JSON.stringify(sparse), { status: 200 })

      const result = await getFitnessCalendarDayActivities({
        actorId: 'test-user',
        date: '2026-09-01',
        timeZone: 'UTC'
      })

      expect(result.activities[0].activityType).toBeNull()
      expect(result.activities[0].statusPath).toBeNull()
      expect(result).toEqual(sparse)
    })

    it('forwards the abort signal to fetch', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(dayPage), { status: 200 })
      const controller = new AbortController()

      await getFitnessCalendarDayActivities({
        actorId: 'test-user',
        date: '2026-09-01',
        timeZone: 'UTC',
        signal: controller.signal
      })

      expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
    })

    it.each([400, 401, 403, 500])(
      'throws an ApiRequestError with the server message on %i',
      async (status) => {
        fetchMock.mockResponseOnce(
          JSON.stringify({ error: `Server said ${status}` }),
          { status }
        )

        const request = getFitnessCalendarDayActivities({
          actorId: 'test-user',
          date: '2026-09-01',
          timeZone: 'UTC'
        })

        await expect(request).rejects.toBeInstanceOf(ApiRequestError)
        await expect(request).rejects.toMatchObject({
          message: `Server said ${status}`,
          status
        })
      }
    )

    it('throws on a 200 missing page fields', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ date: '2026-09-01', activities: [] }),
        { status: 200 }
      )

      await expect(
        getFitnessCalendarDayActivities({
          actorId: 'test-user',
          date: '2026-09-01',
          timeZone: 'UTC'
        })
      ).rejects.toThrow('Fitness day activities response is invalid')
    })

    it('throws on a 200 whose activity is malformed', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          ...dayPage,
          activities: [{ ...dayActivity, startTime: '2026-09-01' }]
        }),
        { status: 200 }
      )

      await expect(
        getFitnessCalendarDayActivities({
          actorId: 'test-user',
          date: '2026-09-01',
          timeZone: 'UTC'
        })
      ).rejects.toThrow('Fitness day activities response is invalid')
    })

    it('throws on a 200 whose body is not JSON', async () => {
      fetchMock.mockResponseOnce('not json', { status: 200 })

      await expect(
        getFitnessCalendarDayActivities({
          actorId: 'test-user',
          date: '2026-09-01',
          timeZone: 'UTC'
        })
      ).rejects.toThrow('Fitness day activities response is invalid')
    })
  })
})

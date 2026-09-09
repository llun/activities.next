/** @vitest-environment jsdom */
import fetchMock from 'jest-fetch-mock'

import { getFitnessCalendarData } from './fitnessCalendar'

describe('fitnessCalendar client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getFitnessCalendarData', () => {
    it('fetches fitness calendar data successfully', async () => {
      const mockData = [
        {
          date: '2026-09-01',
          count: 2,
          totalDistanceMeters: 10000,
          totalDurationSeconds: 3600
        }
      ]

      fetchMock.mockResponseOnce(JSON.stringify(mockData), { status: 200 })

      const result = await getFitnessCalendarData({
        actorId: 'test-user',
        startDate: 1725148800,
        endDate: 1725235200
      })

      expect(result).toEqual(mockData)
      expect(fetchMock).toHaveBeenCalledWith(
        `${window.origin}/api/v1/accounts/test-user/fitness-calendar?start_date=1725148800&end_date=1725235200`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' }
        }
      )
    })

    it('appends activity_type parameter when provided', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

      await getFitnessCalendarData({
        actorId: 'test-user',
        startDate: 1725148800,
        endDate: 1725235200,
        activityType: 'running'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        `${window.origin}/api/v1/accounts/test-user/fitness-calendar?start_date=1725148800&end_date=1725235200&activity_type=running`,
        expect.anything()
      )
    })

    it('correctly encodes actorId with special characters or URLs', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

      await getFitnessCalendarData({
        actorId: 'https://example.com/users/alice',
        startDate: 1725148800,
        endDate: 1725235200
      })

      // toIdPathSegment converts https://example.com/users/alice to example.com:users:alice
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/v1/accounts/example.com:users:alice/fitness-calendar'
        ),
        expect.anything()
      )
    })

    it('returns empty array when request fails', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Server error' }), {
        status: 500
      })

      const result = await getFitnessCalendarData({
        actorId: 'test-user',
        startDate: 1725148800,
        endDate: 1725235200
      })

      expect(result).toEqual([])
    })
  })
})

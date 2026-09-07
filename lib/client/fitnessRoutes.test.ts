import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  deleteFitnessFile,
  getFitnessRouteData,
  getFitnessSummary,
  retryAllFitnessImports
} from './fitnessRoutes'
import { ApiRequestError } from './http'

enableFetchMocks()

describe('fitnessRoutes client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        origin: 'http://llun.test'
      }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  describe('getFitnessRouteData', () => {
    it('fetches route data and returns parsed response', async () => {
      const mockData = {
        samples: [
          { lat: 13.7563, lng: 100.5018, elapsedSeconds: 0, altitude: 10 },
          { lat: 13.7565, lng: 100.502, elapsedSeconds: 5, altitude: 11 }
        ],
        segments: [
          {
            isHiddenByPrivacy: false,
            samples: [
              { lat: 13.7563, lng: 100.5018, elapsedSeconds: 0, altitude: 10 }
            ]
          }
        ],
        totalDurationSeconds: 5,
        powerSeries: [150, 160],
        heartRateSeries: [120, 125],
        altitudeSeries: [10, 11],
        speedSeries: [3.5, 3.6]
      }

      fetchMock.mockResponseOnce(JSON.stringify(mockData), { status: 200 })

      const result = await getFitnessRouteData('fit/123:abc')
      expect(result).toEqual(mockData)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness-files/fit%2F123%3Aabc/route-data',
        {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        }
      )
    })

    it('throws ApiRequestError when response is not ok', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Route data not found' }),
        { status: 404 }
      )

      await expect(getFitnessRouteData('fit-404')).rejects.toThrow(
        ApiRequestError
      )
    })

    it('throws error when response body is null or not valid', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(null), { status: 200 })

      await expect(getFitnessRouteData('fit-null')).rejects.toThrow(
        'Route data response is invalid'
      )
    })

    it('throws error when samples is not an array', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ totalDurationSeconds: 100 }),
        { status: 200 }
      )

      await expect(getFitnessRouteData('fit-invalid')).rejects.toThrow(
        'Route data response is invalid'
      )
    })
  })

  describe('retryAllFitnessImports', () => {
    it('retries all failed fitness imports', async () => {
      const mockResult = {
        retried: 3,
        batches: 2,
        failedBatches: 0
      }
      fetchMock.mockResponseOnce(JSON.stringify(mockResult), { status: 200 })

      const result = await retryAllFitnessImports()
      expect(result).toEqual(mockResult)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fitness/retry-failed', {
        method: 'POST'
      })
    })

    it('throws error when request fails', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Failed to trigger retries' }),
        { status: 500 }
      )

      await expect(retryAllFitnessImports()).rejects.toThrow(
        'Failed to trigger retries'
      )
    })
  })

  describe('getFitnessSummary', () => {
    it('fetches fitness summary with query parameters', async () => {
      const mockSummary = [
        {
          activityType: 'running',
          count: 5,
          totalDistanceMeters: 25000,
          totalDurationSeconds: 7200,
          totalElevationGainMeters: 150
        }
      ]
      fetchMock.mockResponseOnce(JSON.stringify(mockSummary), { status: 200 })

      const result = await getFitnessSummary({
        actorId: 'https://llun.test/users/test-user',
        startDate: 1700000000,
        endDate: 1700086400
      })

      expect(result).toEqual(mockSummary)
      expect(fetchMock).toHaveBeenCalledWith(
        'http://llun.test/api/v1/accounts/llun.test:users:test-user/fitness-summary?start_date=1700000000&end_date=1700086400',
        {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        }
      )
    })

    it('throws error when response is not ok', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401
      })

      await expect(
        getFitnessSummary({
          actorId: 'test-user',
          startDate: 100,
          endDate: 200
        })
      ).rejects.toThrow('Failed to fetch fitness summary: 401')
    })
  })

  describe('deleteFitnessFile', () => {
    it('sends delete request for given fitness file id', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      await expect(deleteFitnessFile('file-123')).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/fitness-files/file-123',
        {
          method: 'DELETE'
        }
      )
    })

    it('throws error when delete request fails', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'File cannot be deleted' }),
        { status: 400 }
      )

      await expect(deleteFitnessFile('file-123')).rejects.toThrow(
        'File cannot be deleted'
      )
    })
  })
})

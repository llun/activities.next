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
    const params = {
      actorId: 'https://llun.test/users/test-user',
      from: '2026-01-01',
      to: '2026-10-04',
      timeZone: 'Asia/Bangkok'
    }
    const summaryRow = {
      activityType: 'running',
      count: 5,
      totalDistanceMeters: 25000,
      totalDurationSeconds: 7200,
      totalElevationGainMeters: 150
    }

    it('fetches the summary from the exact URL', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([summaryRow]), { status: 200 })

      const result = await getFitnessSummary(params)

      expect(result).toEqual([summaryRow])
      expect(fetchMock).toHaveBeenCalledWith(
        'http://llun.test/api/v1/accounts/llun.test:users:test-user/fitness-summary?from=2026-01-01&to=2026-10-04&time_zone=Asia%2FBangkok',
        {
          method: 'GET',
          headers: {
            Accept: 'application/json'
          },
          signal: undefined
        }
      )
    })

    it('does not send the removed start_date and end_date params', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

      await getFitnessSummary(params)

      const url = new URL(fetchMock.mock.calls[0][0] as string)
      expect(url.searchParams.has('start_date')).toBe(false)
      expect(url.searchParams.has('end_date')).toBe(false)
    })

    it('keeps a null activityType as null', async () => {
      const untyped = { ...summaryRow, activityType: null }
      fetchMock.mockResponseOnce(JSON.stringify([untyped]), { status: 200 })

      const result = await getFitnessSummary(params)

      expect(result).toEqual([untyped])
      expect(result[0].activityType).toBeNull()
    })

    it('returns an empty array for a range with no activities', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

      await expect(getFitnessSummary(params)).resolves.toEqual([])
    })

    it('forwards the abort signal to fetch', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })
      const controller = new AbortController()

      await getFitnessSummary({ ...params, signal: controller.signal })

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

      const request = getFitnessSummary({
        ...params,
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

        const request = getFitnessSummary(params)

        await expect(request).rejects.toBeInstanceOf(ApiRequestError)
        await expect(request).rejects.toMatchObject({
          message: `Server said ${status}`,
          status
        })
      }
    )

    it('falls back to a message when the error body is empty', async () => {
      fetchMock.mockResponseOnce('', { status: 500, statusText: '' })

      await expect(getFitnessSummary(params)).rejects.toMatchObject({
        message: 'Failed to fetch fitness summary.',
        status: 500
      })
    })

    it('throws on a 200 whose body is not an array', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ summary: [] }), {
        status: 200
      })

      await expect(getFitnessSummary(params)).rejects.toThrow(
        'Fitness summary response is invalid'
      )
    })

    it('throws on a 200 whose row is malformed', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify([{ ...summaryRow, count: 'five' }]),
        { status: 200 }
      )

      await expect(getFitnessSummary(params)).rejects.toThrow(
        'Fitness summary response is invalid'
      )
    })

    it('throws on a 200 whose body is not JSON', async () => {
      fetchMock.mockResponseOnce('<html>proxy error</html>', { status: 200 })

      await expect(getFitnessSummary(params)).rejects.toThrow(
        'Fitness summary response is invalid'
      )
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

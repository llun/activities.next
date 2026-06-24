import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getConfig } from '@/lib/config'

import { request } from './request'

vi.mock('got', async () => {
  type GotMockOptions = {
    method?: string
    body?: string
    headers?: Record<string, string>
  }

  const { Buffer } = (await vi.importActual(
    'node:buffer'
  )) as typeof import('node:buffer')
  const { Readable } = (await vi.importActual(
    'node:stream'
  )) as typeof import('node:stream')

  const readResponse = async (url: string, options: GotMockOptions) => {
    const response = await fetch(url, {
      method: options.method,
      body: options.body,
      headers: options.headers
    })
    const body = await response.text()

    return { response, body }
  }

  const gotMock = Object.assign(
    async (url: string, options: GotMockOptions) => {
      const { response, body } = await readResponse(url, options)

      return {
        statusCode: response.status,
        body
      }
    },
    {
      stream: (url: string, options: GotMockOptions) => {
        const stream = new Readable({
          read() {}
        })

        void (async () => {
          try {
            const response = await fetch(url, {
              method: options.method,
              body: options.body,
              headers: options.headers
            })
            const headers: Record<string, string> = {}
            response.headers.forEach((value, key) => {
              headers[key] = value
            })

            stream.emit('response', {
              statusCode: response.status,
              headers
            })
            if (stream.destroyed) return

            const body = await response.text()
            if (stream.destroyed) return

            stream.push(Buffer.from(body))
            stream.push(null)
          } catch (error) {
            stream.destroy(
              error instanceof Error ? error : new Error(String(error))
            )
          }
        })()

        return stream
      }
    }
  )

  return { default: gotMock }
})

enableFetchMocks()

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const defaultConfig = mockGetConfig()

describe('request utility', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockGetConfig.mockReturnValue(defaultConfig)
  })

  describe('request', () => {
    it('makes a GET request', async () => {
      // Mock the fetch response
      fetchMock.mockResponseOnce(JSON.stringify({ data: 'test' }), {
        status: 200
      })

      const response = await request({
        url: 'https://example.com/api/test'
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBeDefined()
      expect(response.statusCode).toBe(200)
    })

    it('makes a POST request with body', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      const response = await request({
        url: 'https://example.com/api/test',
        method: 'POST',
        body: JSON.stringify({ test: 'data' }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
    })

    it('uses custom timeout', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ data: 'timeout test' }), {
        status: 200
      })

      const response = await request({
        url: 'https://example.com/api/test',
        responseTimeout: 5000
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
    })

    it('uses custom retry count', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ data: 'retry test' }), {
        status: 200
      })

      const response = await request({
        url: 'https://example.com/api/test',
        numberOfRetry: 0
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
    })

    it('verifies that fetch mocks are used (no real network calls)', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ verified: true }), {
        status: 200
      })

      await request({
        url: 'https://example.com/api/test'
      })

      // Verify that fetch was called (proving the mock is active)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/test',
        expect.objectContaining({
          method: 'GET'
        })
      )
    })

    // These exercise the response-size guard in readResponseBody. They mock the
    // fetch response (intercepted by the got.stream mock) rather than spinning up
    // a real loopback server read through node-fetch, which was flaky on CI: the
    // detached body read could surface a premature-close "Invalid response body"
    // error that raced the real "Response body too large" error.
    it('returns a streamed response within the response size limit', async () => {
      fetchMock.mockResponseOnce('small body', {
        status: 200,
        headers: { 'content-type': 'text/plain', 'content-length': '10' }
      })

      const response = await request({
        url: 'https://example.com/api/test',
        numberOfRetry: 0,
        maxResponseSize: 64
      })

      expect(response.statusCode).toBe(200)
      expect(response.body).toBe('small body')
    })

    it('rejects a streamed response over the response size limit', async () => {
      // No content-length → exercises the per-chunk streaming guard.
      fetchMock.mockResponseOnce('x'.repeat(32), {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      })

      await expect(
        request({
          url: 'https://example.com/api/test',
          numberOfRetry: 0,
          maxResponseSize: 8
        })
      ).rejects.toThrow('Response body too large')
    })

    it('rejects a streamed response with an oversized content length', async () => {
      // content-length exceeds the cap → rejected before reading the body.
      fetchMock.mockResponseOnce('small body', {
        status: 200,
        headers: { 'content-type': 'text/plain', 'content-length': '32' }
      })

      await expect(
        request({
          url: 'https://example.com/api/test',
          numberOfRetry: 0,
          maxResponseSize: 8
        })
      ).rejects.toThrow('Response body too large')
    })

    it('honors a zero-byte max response size', async () => {
      fetchMock.mockResponseOnce('body', {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      })

      await expect(
        request({
          url: 'https://example.com/api/test',
          numberOfRetry: 0,
          maxResponseSize: 0
        })
      ).rejects.toThrow('Response body too large')
    })

    it('does not retry URLs blocked by safe remote fetch validation', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      await expect(
        request({
          url: 'https://127.0.0.1/api/test',
          numberOfRetry: 1
        })
      ).rejects.toMatchObject({
        code: 'ERR_UNSAFE_REMOTE_URL',
        name: 'SafeRemoteFetchError'
      })
      expect(setTimeoutSpy).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each([408, 429, 500, 502, 503, 504, 521, 522, 524])(
      'retries transient HTTP status %s after reading the body',
      async (status) => {
        vi.useFakeTimers()
        fetchMock.mockResponseOnce('temporary upstream failure', { status })
        fetchMock.mockResponseOnce('ok', { status: 200 })

        const responsePromise = request({
          url: 'https://example.com/api/test',
          numberOfRetry: 1,
          retryNoise: null
        })
        await vi.advanceTimersByTimeAsync(1000)

        await expect(responsePromise).resolves.toMatchObject({
          body: 'ok',
          statusCode: 200
        })
        expect(fetchMock).toHaveBeenCalledTimes(2)
      }
    )

    it('does not retry 413 responses', async () => {
      fetchMock.mockResponseOnce('payload too large', { status: 413 })
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const response = await request({
        url: 'https://example.com/api/test',
        numberOfRetry: 1,
        retryNoise: null
      })

      expect(response).toMatchObject({
        body: 'payload too large',
        statusCode: 413
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('honors retry-after before retrying transient HTTP status responses', async () => {
      vi.useFakeTimers()
      fetchMock.mockResponseOnce('rate limited', {
        headers: { 'retry-after': '2' },
        status: 429
      })
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const responsePromise = request({
        url: 'https://example.com/api/test',
        numberOfRetry: 1,
        retryNoise: null
      })
      await vi.advanceTimersByTimeAsync(1000)

      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000)

      await expect(responsePromise).resolves.toMatchObject({
        body: 'ok',
        statusCode: 200
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('honors retry-after with an HTTP-date header', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-14T00:00:00.000Z'))
      const retryAt = new Date(Date.now() + 2000).toUTCString()
      fetchMock.mockResponseOnce('rate limited', {
        headers: { 'retry-after': retryAt },
        status: 429
      })
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const responsePromise = request({
        url: 'https://example.com/api/test',
        numberOfRetry: 1,
        retryNoise: null
      })
      await vi.advanceTimersByTimeAsync(1000)

      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000)

      await expect(responsePromise).resolves.toMatchObject({
        body: 'ok',
        statusCode: 200
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does not retry when retry-after exceeds the request timeout', async () => {
      fetchMock.mockResponseOnce('rate limited', {
        headers: { 'retry-after': '60' },
        status: 429
      })
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const response = await request({
        url: 'https://example.com/api/test',
        numberOfRetry: 1,
        responseTimeout: 1000,
        retryNoise: null
      })

      expect(response).toMatchObject({
        body: 'rate limited',
        statusCode: 429
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not retry transient HTTP status responses for POST requests', async () => {
      fetchMock.mockResponseOnce('temporary upstream failure', { status: 500 })
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const response = await request({
        url: 'https://example.com/api/test',
        method: 'POST',
        numberOfRetry: 1,
        retryNoise: null
      })

      expect(response).toMatchObject({
        body: 'temporary upstream failure',
        statusCode: 500
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it.each([
      'EAI_AGAIN',
      'EADDRINUSE',
      'ECONNREFUSED',
      'ECONNRESET',
      'EPIPE',
      'ENETUNREACH',
      'ENOTFOUND',
      'ETIMEDOUT'
    ])('retries transient socket error %s', async (code) => {
      vi.useFakeTimers()
      const error = Object.assign(new Error(`socket failure: ${code}`), {
        code
      })
      fetchMock.mockRejectOnce(error)
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const responsePromise = request({
        url: 'https://example.com/api/test',
        numberOfRetry: 1,
        retryNoise: null
      })
      await vi.advanceTimersByTimeAsync(1000)

      await expect(responsePromise).resolves.toMatchObject({
        body: 'ok',
        statusCode: 200
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('waits with retry noise before retrying retryable errors', async () => {
      vi.useFakeTimers()
      mockGetConfig.mockReturnValue({
        ...defaultConfig,
        request: {
          timeoutInMilliseconds: 1000,
          numberOfRetry: 1,
          retryNoise: 50,
          maxResponseSizeInBytes: 1024
        }
      })
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const error = Object.assign(new Error('dns lookup timed out'), {
        code: 'EAI_AGAIN'
      })
      fetchMock.mockRejectOnce(error)
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const responsePromise = request({
        url: 'https://example.com/api/test'
      })
      await vi.advanceTimersByTimeAsync(1024)

      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)

      await expect(responsePromise).resolves.toMatchObject({
        body: 'ok',
        statusCode: 200
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('uses absolute retry noise for negative configured values', async () => {
      vi.useFakeTimers()
      mockGetConfig.mockReturnValue({
        ...defaultConfig,
        request: {
          timeoutInMilliseconds: 1000,
          numberOfRetry: 1,
          retryNoise: -50,
          maxResponseSizeInBytes: 1024
        }
      })
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const error = Object.assign(new Error('dns lookup timed out'), {
        code: 'EAI_AGAIN'
      })
      fetchMock.mockRejectOnce(error)
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const responsePromise = request({
        url: 'https://example.com/api/test'
      })
      await vi.advanceTimersByTimeAsync(1024)

      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)

      await expect(responsePromise).resolves.toMatchObject({
        body: 'ok',
        statusCode: 200
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('preserves configured null retry noise', async () => {
      vi.useFakeTimers()
      mockGetConfig.mockReturnValue({
        ...defaultConfig,
        request: {
          timeoutInMilliseconds: 1000,
          numberOfRetry: 1,
          retryNoise: null,
          maxResponseSizeInBytes: 1024
        }
      })
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const error = Object.assign(new Error('dns lookup timed out'), {
        code: 'EAI_AGAIN'
      })
      fetchMock.mockRejectOnce(error)
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const responsePromise = request({
        url: 'https://example.com/api/test'
      })
      await vi.advanceTimersByTimeAsync(1000)

      expect(fetchMock).toHaveBeenCalledTimes(2)
      await expect(responsePromise).resolves.toMatchObject({
        body: 'ok',
        statusCode: 200
      })
    })

    it('preserves configured zero retry noise', async () => {
      vi.useFakeTimers()
      mockGetConfig.mockReturnValue({
        ...defaultConfig,
        request: {
          timeoutInMilliseconds: 1000,
          numberOfRetry: 1,
          retryNoise: 0,
          maxResponseSizeInBytes: 1024
        }
      })
      const randomSpy = vi.spyOn(Math, 'random')
      const error = Object.assign(new Error('dns lookup timed out'), {
        code: 'EAI_AGAIN'
      })
      fetchMock.mockRejectOnce(error)
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const responsePromise = request({
        url: 'https://example.com/api/test'
      })
      await vi.advanceTimersByTimeAsync(1000)

      expect(randomSpy).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await expect(responsePromise).resolves.toMatchObject({
        body: 'ok',
        statusCode: 200
      })
    })

    it('caps retry backoff at thirty seconds', async () => {
      vi.useFakeTimers()
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const error = Object.assign(new Error('dns lookup timed out'), {
        code: 'EAI_AGAIN'
      })
      fetchMock.mockReject(error)

      const responsePromise = request({
        url: 'https://example.com/api/test',
        numberOfRetry: 6,
        retryNoise: 100
      }).catch((error) => error as Error)

      for (const delay of [1100, 2100, 4100, 8100, 16100]) {
        await vi.advanceTimersByTimeAsync(delay)
      }

      const scheduledDelays = setTimeoutSpy.mock.calls.map(([, delay]) => delay)
      expect(scheduledDelays).toEqual([1100, 2100, 4100, 8100, 16100, 30000])

      await vi.advanceTimersByTimeAsync(30000)
      // responsePromise resolves to the caught error (see `.catch` above).
      const settledError = (await responsePromise) as Error
      expect(settledError.message).toContain('dns lookup timed out')
      expect(fetchMock).toHaveBeenCalledTimes(7)
    })
  })
})

import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { type Server, createServer } from 'node:http'
import { type AddressInfo } from 'node:net'

import { getConfig } from '@/lib/config'

import { request } from './request'

jest.mock('got', () => {
  type GotMockOptions = {
    method?: string
    body?: string
    headers?: Record<string, string>
  }

  const { Buffer } = jest.requireActual(
    'node:buffer'
  ) as typeof import('node:buffer')
  const { Readable } = jest.requireActual(
    'node:stream'
  ) as typeof import('node:stream')

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

  return gotMock
})

enableFetchMocks()

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const defaultConfig = mockGetConfig()

const createTestServer = async (
  body: string,
  headers: Record<string, string> = {}
) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain', ...headers })
    response.end(body)
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}` }
}

const closeServer = async (server: Server) => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

const withDevelopmentNodeEnv = async (callback: () => Promise<void>) => {
  const originalNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    await callback()
  } finally {
    if (typeof originalNodeEnv === 'undefined') {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  }
}

describe('request utility', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
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

    it('returns a streamed response within the response size limit', async () => {
      await withDevelopmentNodeEnv(async () => {
        fetchMock.dontMock()
        const { server, url } = await createTestServer('small body')

        try {
          const response = await request({
            url,
            numberOfRetry: 0,
            maxResponseSize: 64
          })

          expect(response.statusCode).toBe(200)
          expect(response.body).toBe('small body')
        } finally {
          await closeServer(server)
        }
      })
    })

    it('rejects a streamed response over the response size limit', async () => {
      await withDevelopmentNodeEnv(async () => {
        fetchMock.dontMock()
        const { server, url } = await createTestServer('x'.repeat(32))

        try {
          await expect(
            request({
              url,
              numberOfRetry: 0,
              maxResponseSize: 8
            })
          ).rejects.toThrow('Response body too large')
        } finally {
          await closeServer(server)
        }
      })
    })

    it('rejects a streamed response with an oversized content length', async () => {
      await withDevelopmentNodeEnv(async () => {
        fetchMock.dontMock()
        const { server, url } = await createTestServer('small body', {
          'content-length': '32'
        })

        try {
          await expect(
            request({
              url,
              numberOfRetry: 0,
              maxResponseSize: 8
            })
          ).rejects.toThrow('Response body too large')
        } finally {
          await closeServer(server)
        }
      })
    })

    it('honors a zero-byte max response size', async () => {
      await withDevelopmentNodeEnv(async () => {
        fetchMock.dontMock()
        const { server, url } = await createTestServer('body')

        try {
          await expect(
            request({
              url,
              numberOfRetry: 0,
              maxResponseSize: 0
            })
          ).rejects.toThrow('Response body too large')
        } finally {
          await closeServer(server)
        }
      })
    })

    it('does not retry local port binding errors', async () => {
      const error = Object.assign(new Error('address in use'), {
        code: 'EADDRINUSE'
      })
      fetchMock.mockRejectOnce(error)
      fetchMock.mockResponseOnce('ok', { status: 200 })

      await expect(
        request({
          url: 'https://example.com/api/test',
          numberOfRetry: 1
        })
      ).rejects.toThrow('address in use')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not retry URLs blocked by safe remote fetch validation', async () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

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

    it('waits with retry noise before retrying retryable errors', async () => {
      jest.useFakeTimers()
      mockGetConfig.mockReturnValue({
        ...defaultConfig,
        request: {
          timeoutInMilliseconds: 1000,
          numberOfRetry: 1,
          retryNoise: 50,
          maxResponseSizeInBytes: 1024
        }
      })
      jest.spyOn(Math, 'random').mockReturnValue(0.5)
      const error = Object.assign(new Error('dns lookup timed out'), {
        code: 'EAI_AGAIN'
      })
      fetchMock.mockRejectOnce(error)
      fetchMock.mockResponseOnce('ok', { status: 200 })

      const responsePromise = request({
        url: 'https://example.com/api/test'
      })
      await jest.advanceTimersByTimeAsync(1024)

      expect(fetchMock).toHaveBeenCalledTimes(1)

      await jest.advanceTimersByTimeAsync(1)

      await expect(responsePromise).resolves.toMatchObject({
        body: 'ok',
        statusCode: 200
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })
})

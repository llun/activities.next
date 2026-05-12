import { Readable } from 'node:stream'

import {
  SafeRemoteFetchTransport,
  createSafeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

const streamFrom = (chunks: string[]) => Readable.from(chunks)

const okResponse = (body = 'ok') => ({
  statusCode: 200,
  headers: { 'content-type': 'text/plain' },
  body: streamFrom([body])
})

describe('safeRemoteFetch', () => {
  it('rejects a redirect whose hostname resolves to a private IPv4 address', async () => {
    const transport: SafeRemoteFetchTransport = jest.fn(async ({ url }) => {
      if (url.hostname === 'safe.example') {
        return {
          statusCode: 302,
          headers: { location: 'https://internal.example/secret' },
          body: streamFrom([])
        }
      }

      return okResponse()
    })
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async (hostname) =>
        hostname === 'internal.example'
          ? [{ address: '10.0.0.5', family: 4 }]
          : [{ address: '203.0.113.10', family: 4 }],
      transport
    })

    await expect(
      safeRemoteFetch({ url: 'https://safe.example/actor' })
    ).rejects.toThrow('Unsafe remote address')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('stops reading when response body exceeds the byte limit', async () => {
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
      transport: async () => ({
        statusCode: 200,
        headers: {},
        body: streamFrom(['1234', '56789'])
      })
    })

    await expect(
      safeRemoteFetch({
        url: 'https://safe.example/large',
        maxBodyBytes: 8
      })
    ).rejects.toThrow('Response body too large')
  })

  it('rejects redirects beyond the configured cap', async () => {
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
      transport: async ({ url }) => {
        const redirectCount = Number(url.pathname.replace('/', '') || '0')
        return {
          statusCode: 302,
          headers: {
            location: `https://safe.example/${redirectCount + 1}`
          },
          body: streamFrom([])
        }
      }
    })

    await expect(
      safeRemoteFetch({
        url: 'https://safe.example/0',
        maxRedirects: 3
      })
    ).rejects.toThrow('Too many redirects')
  })

  it('does not allow a configured redirect cap above three redirects', async () => {
    const transport: SafeRemoteFetchTransport = jest.fn(async ({ url }) => {
      const redirectCount = Number(url.pathname.replace('/', '') || '0')
      return {
        statusCode: 302,
        headers: {
          location: `https://safe.example/${redirectCount + 1}`
        },
        body: streamFrom([])
      }
    })
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
      transport
    })

    await expect(
      safeRemoteFetch({
        url: 'https://safe.example/0',
        maxRedirects: 10
      })
    ).rejects.toThrow('Too many redirects')
    expect(transport).toHaveBeenCalledTimes(4)
  })

  it('rejects redirects that downgrade from HTTPS to HTTP', async () => {
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
      transport: async () => ({
        statusCode: 302,
        headers: { location: 'http://safe.example/plain' },
        body: streamFrom([])
      })
    })

    await expect(
      safeRemoteFetch({ url: 'https://safe.example/actor' })
    ).rejects.toThrow('Only HTTPS remote URLs are allowed')
  })

  it('rejects IPv6 loopback and unique-local addresses', async () => {
    const safeRemoteFetch = createSafeRemoteFetch({
      transport: async () => okResponse()
    })

    await expect(
      safeRemoteFetch({ url: 'https://[::1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
    await expect(
      safeRemoteFetch({ url: 'https://[fc00::1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
  })

  it('only allows loopback addresses for the development localhost exception', async () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const safeRemoteFetch = createSafeRemoteFetch({
        resolveHost: async () => [{ address: '10.0.0.5', family: 4 }],
        transport: async () => okResponse()
      })

      await expect(
        safeRemoteFetch({ url: 'http://localhost/actor' })
      ).rejects.toThrow('Unsafe remote address')
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('strips credentials and auth headers on cross-host redirects', async () => {
    const seenRequests: Array<{
      url: string
      headers: Record<string, string | string[] | undefined>
    }> = []
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
      transport: async ({ headers, url }) => {
        seenRequests.push({ headers, url: url.toString() })
        if (url.hostname === 'safe.example') {
          return {
            statusCode: 302,
            headers: {
              location: 'https://user:pass@other.example/private-key'
            },
            body: streamFrom([])
          }
        }

        return okResponse()
      }
    })

    await safeRemoteFetch({
      url: 'https://safe.example/actor',
      headers: {
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        signature: 'keyId="secret",signature="secret"'
      }
    })

    expect(seenRequests[1]).toEqual({
      url: 'https://other.example/private-key',
      headers: expect.not.objectContaining({
        authorization: expect.any(String),
        cookie: expect.any(String),
        signature: expect.any(String)
      })
    })
  })
})

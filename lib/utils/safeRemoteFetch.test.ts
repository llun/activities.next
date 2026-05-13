import { Readable } from 'node:stream'

import {
  ResolvedRemoteAddress,
  SafeRemoteFetchTransport,
  createSafeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

const mockGotStream = jest.fn()

jest.mock('got', () => ({
  __esModule: true,
  default: {
    stream: (url: string, options: unknown) => mockGotStream(url, options)
  }
}))

const SAFE_ADDRESS = { address: '93.184.216.34', family: 4 as const }

const streamFrom = (chunks: string[]) => Readable.from(chunks)

const okResponse = (body = 'ok') => ({
  statusCode: 200,
  headers: { 'content-type': 'text/plain' },
  body: streamFrom([body])
})

describe('safeRemoteFetch', () => {
  afterEach(() => {
    mockGotStream.mockReset()
  })

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
          : [SAFE_ADDRESS],
      transport
    })

    await expect(
      safeRemoteFetch({ url: 'https://safe.example/actor' })
    ).rejects.toThrow('Unsafe remote address')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('stops reading when response body exceeds the byte limit', async () => {
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
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

  it('rejects immediately when content-length exceeds the byte limit', async () => {
    let readCount = 0
    const body = new Readable({
      read() {
        readCount += 1
        this.push('small')
        this.push(null)
      }
    })
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
      transport: async () => ({
        statusCode: 200,
        headers: { 'content-length': '100' },
        body
      })
    })

    await expect(
      safeRemoteFetch({
        url: 'https://safe.example/large',
        maxBodyBytes: 8
      })
    ).rejects.toThrow('Response body too large')
    expect(readCount).toBe(0)
    expect(body.destroyed).toBe(true)
  })

  it('rejects redirects beyond the configured cap', async () => {
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
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
      resolveHost: async () => [SAFE_ADDRESS],
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
      resolveHost: async () => [SAFE_ADDRESS],
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
    await expect(
      safeRemoteFetch({ url: 'https://[::ffff:10.0.0.1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
    await expect(
      safeRemoteFetch({ url: 'https://[::192.168.0.1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
    await expect(
      safeRemoteFetch({ url: 'https://[64:ff9b::10.0.0.1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
    await expect(
      safeRemoteFetch({ url: 'https://[64:ff9b:1:c0a8:0:100::]/actor' })
    ).rejects.toThrow('Unsafe remote address')
    await expect(
      safeRemoteFetch({ url: 'https://[100::1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
    await expect(
      safeRemoteFetch({ url: 'https://[2001:10::1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
    await expect(
      safeRemoteFetch({ url: 'https://[2001:20::1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
    await expect(
      safeRemoteFetch({ url: 'https://[2001::1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
    await expect(
      safeRemoteFetch({ url: 'https://[2002::1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
    await expect(
      safeRemoteFetch({ url: 'https://[2001:db8::1]/actor' })
    ).rejects.toThrow('Unsafe remote address')
  })

  it('allows NAT64 addresses when the embedded IPv4 address is safe', async () => {
    const transport: SafeRemoteFetchTransport = jest.fn(async () =>
      okResponse()
    )
    const safeRemoteFetch = createSafeRemoteFetch({
      transport
    })

    await expect(
      safeRemoteFetch({ url: 'https://[64:ff9b::93.184.216.34]/actor' })
    ).resolves.toMatchObject({
      body: 'ok',
      statusCode: 200
    })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('rejects reserved IPv4 ranges', async () => {
    const safeRemoteFetch = createSafeRemoteFetch({
      transport: async () => okResponse()
    })

    for (const address of [
      '100.64.0.1',
      '192.0.0.1',
      '192.0.2.1',
      '192.88.99.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1'
    ]) {
      await expect(
        safeRemoteFetch({ url: `https://${address}/actor` })
      ).rejects.toThrow('Unsafe remote address')
    }
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
      if (typeof originalNodeEnv === 'undefined') {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
    }
  })

  it('strips credentials and auth headers on cross-host redirects', async () => {
    const seenRequests: Array<{
      url: string
      headers: Record<string, string | string[] | undefined>
    }> = []
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
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

  it('destroys redirect response bodies without buffering them', async () => {
    const redirectBody = streamFrom(['redirect body'])
    const destroy = jest.spyOn(redirectBody, 'destroy')
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
      transport: async ({ url }) => {
        if (url.pathname === '/from') {
          return {
            statusCode: 302,
            headers: { location: 'https://safe.example/to' },
            body: redirectBody
          }
        }

        return okResponse()
      }
    })

    await expect(
      safeRemoteFetch({ url: 'https://safe.example/from' })
    ).resolves.toMatchObject({
      body: 'ok',
      url: 'https://safe.example/to'
    })
    expect(destroy).toHaveBeenCalled()
  })

  it.each([301, 302, 303])(
    'preserves POST redirects for %s responses',
    async (statusCode) => {
      const seenRequests: Array<{ body?: string; method: string }> = []
      const safeRemoteFetch = createSafeRemoteFetch({
        resolveHost: async () => [SAFE_ADDRESS],
        transport: async ({ body, method, url }) => {
          seenRequests.push({ body, method })
          if (url.pathname === '/from') {
            return {
              statusCode,
              headers: { location: 'https://safe.example/to' },
              body: streamFrom([])
            }
          }

          return okResponse()
        }
      })

      await safeRemoteFetch({
        body: 'payload',
        headers: {
          'content-type': 'text/plain'
        },
        method: 'POST',
        url: 'https://safe.example/from'
      })

      expect(seenRequests).toEqual([
        { body: 'payload', method: 'POST' },
        { body: 'payload', method: 'POST' }
      ])
    }
  )

  it('does not leave got stream error listeners after reading the body', async () => {
    const stream = new Readable({
      read() {}
    })
    mockGotStream.mockImplementationOnce(() => {
      process.nextTick(() => {
        stream.emit('response', {
          headers: {},
          statusCode: 200
        })
        stream.push('ok')
        stream.push(null)
      })
      return stream
    })
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS]
    })

    await expect(
      safeRemoteFetch({ url: 'https://safe.example/actor' })
    ).resolves.toMatchObject({
      body: 'ok',
      statusCode: 200
    })
    expect(stream.listenerCount('error')).toBe(0)
  })

  it('surfaces got stream errors after receiving a response', async () => {
    const stream = new Readable({
      read() {}
    })
    mockGotStream.mockImplementationOnce(() => {
      process.nextTick(() => {
        stream.emit('response', {
          headers: {},
          statusCode: 200
        })
        stream.destroy(new Error('stream failed'))
      })
      return stream
    })
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS]
    })

    await expect(
      safeRemoteFetch({ url: 'https://safe.example/actor' })
    ).rejects.toThrow('stream failed')
  })

  it('preserves all resolved safe addresses for transport fallback', async () => {
    const addresses: ResolvedRemoteAddress[] = [
      { address: '2001:4860:4860::8888', family: 6 },
      SAFE_ADDRESS
    ]
    const seenResolvedAddresses: Array<ResolvedRemoteAddress[] | undefined> = []
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => addresses,
      transport: async (request) => {
        seenResolvedAddresses.push(
          (
            request as {
              resolvedAddresses?: ResolvedRemoteAddress[]
            }
          ).resolvedAddresses
        )
        return okResponse()
      }
    })

    await safeRemoteFetch({ url: 'https://safe.example/actor' })

    expect(seenResolvedAddresses).toEqual([addresses])
  })

  it('pins got DNS lookups to prevalidated addresses for all lookup overloads', async () => {
    const addresses: ResolvedRemoteAddress[] = [
      { address: '2001:4860:4860::8888', family: 6 },
      SAFE_ADDRESS
    ]
    const observedLookups: Array<unknown[]> = []
    mockGotStream.mockImplementationOnce((_url: string, options: unknown) => {
      const stream = new Readable({
        read() {}
      })
      const { dnsLookup } = options as {
        dnsLookup: (
          hostname: string,
          optionsOrCallback: unknown,
          callback?: unknown
        ) => void
      }

      dnsLookup(
        'safe.example',
        { all: true },
        (error: unknown, result: unknown) => {
          observedLookups.push([error, result])
        }
      )
      dnsLookup(
        'safe.example',
        { all: true, family: 4 },
        (error: unknown, result: unknown) => {
          observedLookups.push([error, result])
        }
      )
      dnsLookup(
        'safe.example',
        4,
        (error: unknown, address: unknown, family: unknown) => {
          observedLookups.push([error, address, family])
        }
      )
      dnsLookup(
        'safe.example',
        (error: unknown, address: unknown, family: unknown) => {
          observedLookups.push([error, address, family])
        }
      )

      process.nextTick(() => {
        stream.emit('response', {
          headers: {},
          statusCode: 200
        })
        stream.push('ok')
        stream.push(null)
      })
      return stream
    })
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => addresses
    })

    await expect(
      safeRemoteFetch({ url: 'https://safe.example/actor' })
    ).resolves.toMatchObject({
      body: 'ok',
      statusCode: 200
    })
    expect(observedLookups).toEqual([
      [null, addresses],
      [null, [SAFE_ADDRESS]],
      [null, SAFE_ADDRESS.address, SAFE_ADDRESS.family],
      [null, addresses[0]?.address, addresses[0]?.family]
    ])
  })
})

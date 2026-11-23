import { Readable } from 'node:stream'

import { isAbortError } from '@/lib/utils/isAbortError'
import {
  ResolvedRemoteAddress,
  SafeRemoteFetchTransport,
  createSafeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

const mockGotStream = vi.fn()

vi.mock('got', () => ({
  __esModule: true,
  default: {
    stream: (url: string, options: unknown) => mockGotStream(url, options)
  }
}))

const SAFE_ADDRESS = { address: '93.184.216.34', family: 4 as const }

const streamFrom = (chunks: Array<string | Buffer>) => Readable.from(chunks)

const okResponse = (body = 'ok') => ({
  statusCode: 200,
  headers: { 'content-type': 'text/plain' },
  body: streamFrom([body])
})

const expectSensitiveHeadersStripped = (
  headers: Record<string, string | string[] | undefined>
) => {
  expect(headers).not.toHaveProperty('authorization')
  expect(headers).not.toHaveProperty('cookie')
  expect(headers).not.toHaveProperty('signature')
  expect(headers).not.toHaveProperty('signature-input')
}

describe('safeRemoteFetch', () => {
  afterEach(() => {
    mockGotStream.mockReset()
  })

  it('rejects a redirect whose hostname resolves to a private IPv4 address', async () => {
    const transport: SafeRemoteFetchTransport = vi.fn(async ({ url }) => {
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

  it('truncates body and destroys stream when onBodyTooLarge is truncate', async () => {
    let chunksPushed = 0
    const body = new Readable({
      read() {
        chunksPushed += 1
        this.push('1234')
        this.push('5678')
        this.push('9012')
        this.push(null)
      }
    })
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
      transport: async () => ({
        statusCode: 200,
        headers: {},
        body
      })
    })

    const result = await safeRemoteFetch({
      url: 'https://safe.example/truncate',
      maxBodyBytes: 8,
      onBodyTooLarge: 'truncate'
    })

    expect(result.body).toBe('12345678')
    expect(result.bodyTruncated).toBe(true)
    expect(body.destroyed).toBe(true)
  })

  it('does not reject on over-cap content-length when onBodyTooLarge is truncate', async () => {
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
      transport: async () => ({
        statusCode: 200,
        headers: { 'content-length': '100' },
        body: streamFrom(['1234', '5678', '9012'])
      })
    })

    const result = await safeRemoteFetch({
      url: 'https://safe.example/truncate-length',
      maxBodyBytes: 8,
      onBodyTooLarge: 'truncate'
    })

    expect(result.body).toBe('12345678')
    expect(result.bodyTruncated).toBe(true)
  })

  it('returns bodyTruncated false when body is within byte limit', async () => {
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
      transport: async () => ({
        statusCode: 200,
        headers: {},
        body: streamFrom(['1234', '5678'])
      })
    })

    const result = await safeRemoteFetch({
      url: 'https://safe.example/exact',
      maxBodyBytes: 8,
      onBodyTooLarge: 'truncate'
    })

    expect(result.body).toBe('12345678')
    expect(result.bodyTruncated).toBe(false)
  })

  describe('allowCrossHostRedirects: false', () => {
    const createRedirectingFetch = (
      location: string,
      seenUrls: string[] = []
    ) =>
      createSafeRemoteFetch({
        resolveHost: async () => [SAFE_ADDRESS],
        transport: async ({ url }) => {
          seenUrls.push(url.toString())
          if (url.pathname === '/start') {
            return {
              statusCode: 302,
              headers: { location },
              body: streamFrom([])
            }
          }
          return okResponse('final')
        }
      })

    it('refuses a cross-host redirect without contacting the other host', async () => {
      const seenUrls: string[] = []
      const safeRemoteFetch = createRedirectingFetch(
        'https://other.example/forged',
        seenUrls
      )

      await expect(
        safeRemoteFetch({
          url: 'https://safe.example/start',
          allowCrossHostRedirects: false
        })
      ).rejects.toMatchObject({ code: 'ERR_CROSS_HOST_REDIRECT' })
      expect(seenUrls).toEqual(['https://safe.example/start'])
    })

    it('treats a different port on the same hostname as another host', async () => {
      const safeRemoteFetch = createRedirectingFetch(
        'https://safe.example:8443/forged'
      )

      await expect(
        safeRemoteFetch({
          url: 'https://safe.example/start',
          allowCrossHostRedirects: false
        })
      ).rejects.toMatchObject({ code: 'ERR_CROSS_HOST_REDIRECT' })
    })

    it('still follows a same-host redirect', async () => {
      const safeRemoteFetch = createRedirectingFetch(
        'https://safe.example/canonical'
      )

      const result = await safeRemoteFetch({
        url: 'https://safe.example/start',
        allowCrossHostRedirects: false
      })

      expect(result.body).toBe('final')
      expect(result.url).toBe('https://safe.example/canonical')
    })

    it('follows cross-host redirects by default', async () => {
      const safeRemoteFetch = createRedirectingFetch(
        'https://other.example/elsewhere'
      )

      const result = await safeRemoteFetch({
        url: 'https://safe.example/start'
      })

      expect(result.url).toBe('https://other.example/elsewhere')
    })

    it('asks a policy function about each cross-host hop only', async () => {
      const seenUrls: string[] = []
      const safeRemoteFetch = createRedirectingFetch(
        'https://other.example/forged',
        seenUrls
      )
      const policy = vi.fn(async () => false)

      await expect(
        safeRemoteFetch({
          url: 'https://safe.example/start',
          allowCrossHostRedirects: policy
        })
      ).rejects.toMatchObject({ code: 'ERR_CROSS_HOST_REDIRECT' })
      expect(seenUrls).toEqual(['https://safe.example/start'])
      expect(policy).toHaveBeenCalledWith(
        new URL('https://other.example/forged')
      )

      policy.mockResolvedValue(true)
      const result = await safeRemoteFetch({
        url: 'https://safe.example/start',
        allowCrossHostRedirects: policy
      })
      expect(result.url).toBe('https://other.example/forged')

      policy.mockClear()
      await createRedirectingFetch('https://safe.example/canonical')({
        url: 'https://safe.example/start',
        allowCrossHostRedirects: policy
      })
      expect(policy).not.toHaveBeenCalled()
    })

    it('refuses the hop when a policy function throws', async () => {
      const seenUrls: string[] = []
      const safeRemoteFetch = createRedirectingFetch(
        'https://other.example/forged',
        seenUrls
      )
      const policy = vi.fn(async () => {
        throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' })
      })

      await expect(
        safeRemoteFetch({
          url: 'https://safe.example/start',
          allowCrossHostRedirects: policy
        })
      ).rejects.toMatchObject({ code: 'ERR_CROSS_HOST_REDIRECT' })
      expect(seenUrls).toEqual(['https://safe.example/start'])
    })
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
    const transport: SafeRemoteFetchTransport = vi.fn(async ({ url }) => {
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
    const transport: SafeRemoteFetchTransport = vi.fn(async () => okResponse())
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
    const env = process.env as Record<string, string | undefined>
    env.NODE_ENV = 'development'
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
        delete env.NODE_ENV
      } else {
        env.NODE_ENV = originalNodeEnv
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
        signature: 'keyId="secret",signature="secret"',
        'signature-input': 'sig1=("@method" "@target-uri")'
      }
    })

    expect(seenRequests[1]?.url).toBe('https://other.example/private-key')
    expectSensitiveHeadersStripped(seenRequests[1].headers)
  })

  it('strips dynamic credentials and auth headers on cross-host redirects', async () => {
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
              location: 'https://other.example/private-key'
            },
            body: streamFrom([])
          }
        }

        return okResponse()
      }
    })

    await safeRemoteFetch({
      url: 'https://safe.example/actor',
      headers: ({ url }) => ({
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        signature: `keyId="${url.toString()}",signature="secret"`,
        'signature-input': `sig1=("@target-uri");keyid="${url.toString()}"`
      })
    })

    expect(seenRequests[1]?.url).toBe('https://other.example/private-key')
    expectSensitiveHeadersStripped(seenRequests[1].headers)
  })

  it('keeps dynamic credentials stripped after cross-host redirect chains', async () => {
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
              location: 'https://other.example/redirected'
            },
            body: streamFrom([])
          }
        }

        if (url.pathname === '/redirected') {
          return {
            statusCode: 302,
            headers: {
              location: 'https://other.example/final'
            },
            body: streamFrom([])
          }
        }

        return okResponse()
      }
    })

    await safeRemoteFetch({
      url: 'https://safe.example/actor',
      headers: ({ url }) => ({
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        signature: `keyId="${url.toString()}",signature="secret"`,
        'signature-input': `sig1=("@target-uri");keyid="${url.toString()}"`
      })
    })

    expect(seenRequests).toHaveLength(3)
    expect(seenRequests[0]).toEqual({
      url: 'https://safe.example/actor',
      headers: expect.objectContaining({
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        host: 'safe.example',
        signature: 'keyId="https://safe.example/actor",signature="secret"'
      })
    })
    expect(seenRequests[1]?.url).toBe('https://other.example/redirected')
    expectSensitiveHeadersStripped(seenRequests[1].headers)
    expect(seenRequests[2]?.url).toBe('https://other.example/final')
    expectSensitiveHeadersStripped(seenRequests[2].headers)
  })

  it('destroys redirect response bodies without buffering them', async () => {
    const redirectBody = streamFrom(['redirect body'])
    const destroy = vi.spyOn(redirectBody, 'destroy')
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

  it.each([301, 302])(
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

  it('converts POST redirects to GET for 303 responses', async () => {
    const seenRequests: Array<{
      body?: string
      headers: Record<string, string | string[] | undefined>
      method: string
    }> = []
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
      transport: async ({ body, headers, method, url }) => {
        seenRequests.push({ body, headers, method })
        if (url.pathname === '/from') {
          return {
            statusCode: 303,
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
        'content-encoding': 'gzip',
        'content-language': 'en',
        'content-location': '/payload',
        'content-type': 'text/plain',
        digest: 'sha-256=payload',
        signature: 'keyId="secret",signature="secret"',
        'signature-input': 'sig1=("@method" "@target-uri" "content-digest")'
      },
      method: 'POST',
      url: 'https://safe.example/from'
    })

    expect(seenRequests).toEqual([
      {
        body: 'payload',
        headers: expect.objectContaining({
          'content-encoding': 'gzip',
          'content-language': 'en',
          'content-location': '/payload',
          'content-type': 'text/plain',
          digest: 'sha-256=payload',
          host: 'safe.example',
          signature: 'keyId="secret",signature="secret"',
          'signature-input': 'sig1=("@method" "@target-uri" "content-digest")'
        }),
        method: 'POST'
      },
      {
        body: undefined,
        headers: {
          host: 'safe.example'
        },
        method: 'GET'
      }
    ])
  })

  it('rebuilds dynamic headers without body headers after 303 redirects', async () => {
    const headerBuilderRequests: Array<{
      body?: string
      method: string
      url: string
    }> = []
    const seenRequests: Array<{
      body?: string
      headers: Record<string, string | string[] | undefined>
      method: string
    }> = []
    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
      transport: async ({ body, headers, method, url }) => {
        seenRequests.push({ body, headers, method })
        if (url.pathname === '/from') {
          return {
            statusCode: 303,
            headers: { location: 'https://safe.example/to' },
            body: streamFrom([])
          }
        }

        return okResponse()
      }
    })

    await safeRemoteFetch({
      body: 'payload',
      headers: ({ body, method, url }) => {
        headerBuilderRequests.push({
          body,
          method,
          url: url.toString()
        })

        return {
          'content-type': 'text/plain',
          digest: 'sha-256=payload',
          signature: `keyId="${url.toString()}",signature="${method}-${body ?? 'none'}"`,
          'signature-input': `sig1=("@target-uri");keyid="${url.toString()}"`
        }
      },
      method: 'POST',
      url: 'https://safe.example/from'
    })

    expect(headerBuilderRequests).toEqual([
      {
        body: 'payload',
        method: 'POST',
        url: 'https://safe.example/from'
      },
      {
        body: undefined,
        method: 'GET',
        url: 'https://safe.example/to'
      }
    ])
    expect(seenRequests).toEqual([
      {
        body: 'payload',
        headers: expect.objectContaining({
          'content-type': 'text/plain',
          digest: 'sha-256=payload',
          host: 'safe.example',
          signature:
            'keyId="https://safe.example/from",signature="POST-payload"',
          'signature-input':
            'sig1=("@target-uri");keyid="https://safe.example/from"'
        }),
        method: 'POST'
      },
      {
        body: undefined,
        headers: {
          host: 'safe.example',
          signature: 'keyId="https://safe.example/to",signature="GET-none"',
          'signature-input':
            'sig1=("@target-uri");keyid="https://safe.example/to"'
        },
        method: 'GET'
      }
    ])
  })

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

  it('enables HTTP/2 auto-detection when delegating to got transport', async () => {
    let observedOptions: { http2?: boolean } | undefined
    mockGotStream.mockImplementationOnce((_url: string, options: unknown) => {
      observedOptions = options as { http2?: boolean }
      const stream = new Readable({
        read() {}
      })
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
    expect(observedOptions).toMatchObject({
      http2: true
    })
  })

  it('rejects immediately when signal is already aborted without resolving host', async () => {
    const controller = new AbortController()
    controller.abort()

    const resolveHost = vi.fn(async () => [SAFE_ADDRESS])
    const transport = vi.fn<SafeRemoteFetchTransport>(async () => okResponse())
    const safeRemoteFetch = createSafeRemoteFetch({ resolveHost, transport })

    let caughtError: unknown
    try {
      await safeRemoteFetch({
        signal: controller.signal,
        url: 'https://safe.example/page'
      })
    } catch (error) {
      caughtError = error
    }

    expect(isAbortError(caughtError)).toBe(true)
    expect(resolveHost).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('destroys got stream and rejects with AbortError when aborted before response', async () => {
    const controller = new AbortController()
    let destroyed = false

    mockGotStream.mockImplementationOnce(() => {
      const stream = new Readable({
        read() {},
        destroy(err, callback) {
          destroyed = true
          callback(err)
        }
      })
      queueMicrotask(() => {
        controller.abort()
      })
      return stream
    })

    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS]
    })

    let caughtError: unknown
    try {
      await safeRemoteFetch({
        signal: controller.signal,
        url: 'https://safe.example/slow'
      })
    } catch (error) {
      caughtError = error
    }

    expect(isAbortError(caughtError)).toBe(true)
    expect(destroyed).toBe(true)
  })

  it('destroys response stream and rejects with AbortError when aborted mid-body', async () => {
    const controller = new AbortController()
    let bodyDestroyed = false
    let pushed = false

    const bodyStream = new Readable({
      read() {
        if (pushed) return
        pushed = true
        this.push('<html><head>')
      },
      destroy(err, callback) {
        bodyDestroyed = true
        callback(err)
      }
    })

    const transport = vi.fn<SafeRemoteFetchTransport>(async () => {
      setTimeout(() => controller.abort(), 5)
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: bodyStream
      }
    })

    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
      transport
    })

    let caughtError: unknown
    try {
      await safeRemoteFetch({
        signal: controller.signal,
        url: 'https://safe.example/streaming'
      })
    } catch (error) {
      caughtError = error
    }

    expect(isAbortError(caughtError)).toBe(true)
    expect(bodyDestroyed).toBe(true)
  })

  it('aborts before following redirect when signal fires during redirect policy', async () => {
    const controller = new AbortController()
    const transport = vi.fn<SafeRemoteFetchTransport>(async () => ({
      statusCode: 302,
      headers: { location: 'https://other.example/final' },
      body: streamFrom([''])
    }))

    const safeRemoteFetch = createSafeRemoteFetch({
      resolveHost: async () => [SAFE_ADDRESS],
      transport
    })

    let caughtError: unknown
    try {
      await safeRemoteFetch({
        allowCrossHostRedirects: async () => {
          controller.abort()
          return true
        },
        signal: controller.signal,
        url: 'https://safe.example/start'
      })
    } catch (error) {
      caughtError = error
    }

    expect(isAbortError(caughtError)).toBe(true)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  describe('allowPrivateNetwork', () => {
    it.each([
      {
        label: 'HTTP private RFC 1918 IPv4',
        url: 'http://192.168.1.20:11434/v1/embeddings',
        address: { address: '192.168.1.20', family: 4 as const }
      },
      {
        label: 'HTTPS private RFC 1918 IPv4',
        url: 'https://ollama.internal/v1/embeddings',
        address: { address: '10.0.0.5', family: 4 as const }
      },
      {
        label: 'HTTP IPv4 loopback',
        url: 'http://127.0.0.1:11434/v1/embeddings',
        address: { address: '127.0.0.1', family: 4 as const }
      },
      {
        label: 'HTTP IPv6 loopback',
        url: 'http://[::1]:11434/v1/embeddings',
        address: { address: '::1', family: 6 as const }
      },
      {
        label: 'HTTP IPv4 link-local',
        url: 'http://169.254.1.10/v1/embeddings',
        address: { address: '169.254.1.10', family: 4 as const }
      },
      {
        label: 'HTTP IPv6 link-local',
        url: 'http://[fe80::1]/v1/embeddings',
        address: { address: 'fe80::1', family: 6 as const }
      },
      {
        label: 'HTTPS IPv6 unique-local',
        url: 'https://[fd00::1]/v1/embeddings',
        address: { address: 'fd00::1', family: 6 as const }
      }
    ])(
      'rejects $label by default and permits it when allowPrivateNetwork is true',
      async ({ url, address }) => {
        const defaultTransport = vi.fn<SafeRemoteFetchTransport>(async () =>
          okResponse('blocked')
        )
        const defaultFetch = createSafeRemoteFetch({
          resolveHost: async () => [address],
          transport: defaultTransport
        })

        await expect(defaultFetch({ url })).rejects.toMatchObject({
          code: 'ERR_UNSAFE_REMOTE_URL'
        })
        expect(defaultTransport).not.toHaveBeenCalled()

        const privateTransport = vi.fn<SafeRemoteFetchTransport>(async () =>
          okResponse('ok')
        )
        const privateFetch = createSafeRemoteFetch({
          allowPrivateNetwork: true,
          resolveHost: async () => [address],
          transport: privateTransport
        })

        const result = await privateFetch({ url })
        expect(result).toMatchObject({
          body: 'ok',
          statusCode: 200
        })
        expect(privateTransport).toHaveBeenCalledTimes(1)
        expect(privateTransport).toHaveBeenCalledWith(
          expect.objectContaining({
            resolvedAddress: address,
            resolvedAddresses: [address]
          })
        )
      }
    )

    it('still rejects non-HTTP(S) protocols when allowPrivateNetwork is true', async () => {
      const transport = vi.fn<SafeRemoteFetchTransport>(async () =>
        okResponse()
      )
      const privateFetch = createSafeRemoteFetch({
        allowPrivateNetwork: true,
        resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
        transport
      })

      await expect(
        privateFetch({ url: 'file:///etc/passwd' })
      ).rejects.toMatchObject({
        code: 'ERR_UNSAFE_REMOTE_URL',
        message: 'Only HTTP and HTTPS remote URLs are allowed'
      })
      await expect(
        privateFetch({ url: 'ftp://192.168.1.20/file' })
      ).rejects.toMatchObject({
        code: 'ERR_UNSAFE_REMOTE_URL'
      })
      expect(transport).not.toHaveBeenCalled()
    })

    it('keeps DNS pinning, timeouts, body cap, and redirect restrictions when allowPrivateNetwork is true', async () => {
      const privateAddress: ResolvedRemoteAddress = {
        address: '192.168.1.20',
        family: 4
      }
      const seenRequests: Array<{
        connectTimeoutInMilliseconds: number
        readTimeoutInMilliseconds: number
        resolvedAddresses: ResolvedRemoteAddress[]
      }> = []

      const privateFetch = createSafeRemoteFetch({
        allowPrivateNetwork: true,
        resolveHost: async () => [privateAddress],
        transport: async (request) => {
          seenRequests.push({
            connectTimeoutInMilliseconds: request.connectTimeoutInMilliseconds,
            readTimeoutInMilliseconds: request.readTimeoutInMilliseconds,
            resolvedAddresses: request.resolvedAddresses
          })
          if (request.url.pathname === '/large') {
            return {
              statusCode: 200,
              headers: {},
              body: streamFrom(['123456789'])
            }
          }
          if (request.url.pathname === '/redirect') {
            return {
              statusCode: 302,
              headers: { location: 'http://192.168.1.21/other' },
              body: streamFrom([])
            }
          }
          return okResponse('ok')
        }
      })

      const okResult = await privateFetch({
        url: 'http://ollama.local:11434/v1/embeddings',
        timeoutInMilliseconds: 2500
      })
      expect(okResult.body).toBe('ok')
      expect(seenRequests[0]).toEqual({
        connectTimeoutInMilliseconds: 2500,
        readTimeoutInMilliseconds: 2500,
        resolvedAddresses: [privateAddress]
      })

      await expect(
        privateFetch({
          url: 'http://ollama.local:11434/large',
          maxBodyBytes: 4
        })
      ).rejects.toMatchObject({ code: 'ERR_RESPONSE_TOO_LARGE' })

      await expect(
        privateFetch({
          url: 'http://ollama.local:11434/redirect',
          maxRedirects: 0
        })
      ).rejects.toMatchObject({ code: 'ERR_TOO_MANY_REDIRECTS' })

      await expect(
        privateFetch({
          url: 'http://ollama.local:11434/redirect',
          allowCrossHostRedirects: false
        })
      ).rejects.toMatchObject({ code: 'ERR_CROSS_HOST_REDIRECT' })
    })
  })
})

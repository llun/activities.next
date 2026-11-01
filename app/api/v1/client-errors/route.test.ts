import { NextRequest } from 'next/server'

import { SMALL_REQUEST_BODY_MAX_BYTES } from '@/lib/utils/boundedRequestBody'
import {
  CLIENT_ERRORS_PATH,
  CLIENT_ERROR_MAX_LENGTHS
} from '@/lib/utils/clientErrors/types'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  trustProxy: true
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: mocks.error,
    warn: mocks.warn,
    info: mocks.info,
    debug: vi.fn()
  }
}))

vi.mock('@/lib/config/trustProxyIpHeaders', () => ({
  getTrustProxyIpHeadersConfig: () => mocks.trustProxy
}))

const ORIGIN = 'https://test.llun.dev'

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  message: 'Something broke',
  stack:
    'Error: Something broke\n    at Component (https://test.llun.dev/app.js:1:2)',
  digest: 'digest-123',
  pathname: '/status/test',
  userAgent: 'Mozilla/5.0 TestBrowser',
  buildVersion: '1.0.0',
  source: 'error' as const,
  ...overrides
})

const createRequest = (
  body: unknown,
  options: {
    headers?: Record<string, string>
    url?: string
  } = {}
) => {
  const { headers = {}, url = `${ORIGIN}${CLIENT_ERRORS_PATH}` } = options
  const serializedBody =
    typeof body === 'string'
      ? body
      : body !== undefined
        ? JSON.stringify(body)
        : ''
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      ...headers
    },
    body: serializedBody
  })
}

let POST: typeof import('./route').POST
const post = (req: NextRequest) => POST(req, { params: Promise.resolve({}) })

describe('POST /api/v1/client-errors', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.error.mockClear()
    mocks.warn.mockClear()
    mocks.info.mockClear()
    mocks.trustProxy = true
    ;({ POST } = await import('./route'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers 202 and logs once with an Error whose stack and message are sanitised', async () => {
    const payload = validPayload({
      pathname: '/status/123?token=secret#section',
      message:
        'Loading chunk failed: https://test.llun.dev/_next/static/chunks/app.js?token=xyz#hash',
      stack:
        'Error: Loading chunk failed: https://test.llun.dev/_next/static/chunks/app.js?token=xyz#hash\n    at https://test.llun.dev/main.js:10:20?token=abc#frag'
    })

    const response = await post(createRequest(payload))
    expect(response.status).toBe(202)

    expect(mocks.error).toHaveBeenCalledTimes(1)
    const logCall = mocks.error.mock.calls[0][0]
    expect(logCall.message).toBe('Client error: error')
    expect(logCall.pathname).toBe('/status/123')
    expect(logCall.source).toBe('error')
    expect(logCall.digest).toBe('digest-123')
    expect(logCall.userAgent).toBe('Mozilla/5.0 TestBrowser')
    expect(logCall.buildVersion).toBe('1.0.0')

    expect(logCall.err).toBeInstanceOf(Error)
    expect(logCall.err.message).toBe(
      'Loading chunk failed: https://test.llun.dev/_next/static/chunks/app.js'
    )
    expect(logCall.err.stack).toBe(
      'Error: Loading chunk failed: https://test.llun.dev/_next/static/chunks/app.js\n    at https://test.llun.dev/main.js:10:20'
    )
  })

  it('prepends the Error: <message> title line when the stack lacks one (Safari stacks)', async () => {
    const payload = validPayload({
      message: 'Safari error',
      stack: 'onClick@https://test.llun.dev/app.js:5:10'
    })

    const response = await post(createRequest(payload))
    expect(response.status).toBe(202)

    const logCall = mocks.error.mock.calls[0][0]
    expect(logCall.err.stack).toBe(
      'Error: Safari error\n    at onClick (https://test.llun.dev/app.js:5:10)'
    )
  })

  it('uses the submitted error name and normalizes Safari frames', async () => {
    const response = await post(
      createRequest(
        validPayload({
          name: 'TypeError',
          message: 'Cannot read property',
          stack:
            'TypeError: Cannot read property\nonClick@https://test.llun.dev/app.js:5:10\n@https://test.llun.dev/vendor.js:8:2'
        })
      )
    )
    expect(response.status).toBe(202)
    const { err } = mocks.error.mock.calls[0][0]
    expect(err.name).toBe('TypeError')
    expect(err.stack).toBe(
      'TypeError: Cannot read property\n    at onClick (https://test.llun.dev/app.js:5:10)\n    at <anonymous> (https://test.llun.dev/vendor.js:8:2)'
    )
  })

  it.each(['/u/heatmaps', '/embed/heatmap', '/api/v1/webhooks/strava'])(
    'redacts token paths in all logger arguments for %s',
    async (prefix) => {
      const response = await post(
        createRequest(
          validPayload({
            pathname: `${prefix}/pathname-secret/tiles?query=secret#hash`,
            message: `Failed https://host${prefix}/message-secret/image`,
            stack: `fn@https://host${prefix}/stack-secret:1:2`
          })
        )
      )
      expect(response.status).toBe(202)
      expect(mocks.error).toHaveBeenCalledTimes(1)
      const log = mocks.error.mock.calls[0][0]
      expect(log.pathname).toBe(`${prefix}/[token]/tiles`)
      expect(log.err.message).toBe(`Failed https://host${prefix}/[token]/image`)
      expect(log.err.stack).toBe(
        `Error: Failed https://host${prefix}/[token]/image\n    at fn (https://host${prefix}/[token]:1:2)`
      )
      // Error properties are non-enumerable, so inspect them explicitly too.
      const logged = JSON.stringify({
        ...log,
        err: {
          name: log.err.name,
          message: log.err.message,
          stack: log.err.stack
        }
      })
      for (const secret of [
        'pathname-secret',
        'message-secret',
        'stack-secret'
      ]) {
        expect(logged).not.toContain(secret)
      }
    }
  )

  it('strips a query containing ) through the end of its URL token', async () => {
    const response = await post(
      createRequest(
        validPayload({
          message: 'Failed https://host/a.js?redirect=/a(b)&token=secret',
          stack: '    at fn (https://host/a.js?redirect=/a(b)&token=secret:2:3)'
        })
      )
    )
    expect(response.status).toBe(202)
    const { err } = mocks.error.mock.calls[0][0]
    expect(err.message).toBe('Failed https://host/a.js')
    expect(err.stack).toBe(
      'Error: Failed https://host/a.js\n    at fn (https://host/a.js:2:3)'
    )
  })

  it('drops URL userinfo from the logged message and stack', async () => {
    const response = await post(
      createRequest(
        validPayload({
          message: 'Failed https://user:password@host/a.js',
          stack: 'fn@https://user:password@host/a.js:1:2'
        })
      )
    )
    expect(response.status).toBe(202)
    const { err } = mocks.error.mock.calls[0][0]
    expect(err.message).toBe('Failed https://host/a.js')
    expect(err.stack).toBe(
      'Error: Failed https://host/a.js\n    at fn (https://host/a.js:1:2)'
    )
  })

  it('sanitises a query URL in name before setting err.name and its header', async () => {
    const response = await post(
      createRequest(
        validPayload({
          name: 'https://user:password@host/error?token=secret',
          stack: undefined
        })
      )
    )
    expect(response.status).toBe(202)
    const { err } = mocks.error.mock.calls[0][0]
    expect(err.name).toBe('https://host/error')
    expect(err.stack).toBe('https://host/error: Something broke')
  })

  it.each(['digest', 'buildVersion'])(
    'returns 422 for invalid %s without logging',
    async (field) => {
      const response = await post(
        createRequest(validPayload({ [field]: 'https://host/?token=secret' }))
      )
      expect(response.status).toBe(422)
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it('sets err.stack to just the header line when no client stack is sent', async () => {
    const payload = validPayload({
      message: 'Stackless error',
      stack: undefined
    })

    const response = await post(createRequest(payload))
    expect(response.status).toBe(202)

    const logCall = mocks.error.mock.calls[0][0]
    expect(logCall.err.stack).toBe('Error: Stackless error')
  })

  it('returns 403 without same-origin proof', async () => {
    const req = createRequest(validPayload(), {
      headers: { Origin: 'https://evil.example.com' }
    })
    const response = await post(req)
    expect(response.status).toBe(403)
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('requires application/json content-type and allows charset parameter', async () => {
    const textReq = createRequest(validPayload(), {
      headers: { 'Content-Type': 'text/plain' }
    })
    const textRes = await post(textReq)
    expect(textRes.status).toBe(400)

    const noTypeReq = createRequest(validPayload(), {
      headers: { 'Content-Type': '' }
    })
    const noTypeRes = await post(noTypeReq)
    expect(noTypeRes.status).toBe(400)

    const charsetReq = createRequest(validPayload(), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    })
    const charsetRes = await post(charsetReq)
    expect(charsetRes.status).toBe(202)
  })

  it('returns 400 on bad JSON', async () => {
    const req = createRequest('{"unclosed: json', {
      headers: { 'Content-Type': 'application/json' }
    })
    const response = await post(req)
    expect(response.status).toBe(400)
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('returns 413 when payload exceeds limit', async () => {
    const hugeBody = 'x'.repeat(SMALL_REQUEST_BODY_MAX_BYTES + 10)
    const req = createRequest(hugeBody, {
      headers: { 'Content-Type': 'application/json' }
    })
    const response = await post(req)
    expect(response.status).toBe(413)
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('returns 422 for unknown fields and over-cap fields', async () => {
    // Unknown field
    const unknownFieldRes = await post(
      createRequest(validPayload({ extraUnexpectedField: 'bad' }))
    )
    expect(unknownFieldRes.status).toBe(422)

    // Over-cap message
    const overMessageRes = await post(
      createRequest(
        validPayload({
          message: 'a'.repeat(CLIENT_ERROR_MAX_LENGTHS.message + 1)
        })
      )
    )
    expect(overMessageRes.status).toBe(422)

    const overNameRes = await post(
      createRequest(
        validPayload({ name: 'a'.repeat(CLIENT_ERROR_MAX_LENGTHS.name + 1) })
      )
    )
    expect(overNameRes.status).toBe(422)

    // Over-cap stack
    const overStackRes = await post(
      createRequest(
        validPayload({
          stack: 'a'.repeat(CLIENT_ERROR_MAX_LENGTHS.stack + 1)
        })
      )
    )
    expect(overStackRes.status).toBe(422)

    // Over-cap pathname
    const overPathRes = await post(
      createRequest(
        validPayload({
          pathname: '/' + 'a'.repeat(CLIENT_ERROR_MAX_LENGTHS.pathname)
        })
      )
    )
    expect(overPathRes.status).toBe(422)

    // Pathname not starting with /
    const invalidPathRes = await post(
      createRequest(validPayload({ pathname: 'no-leading-slash' }))
    )
    expect(invalidPathRes.status).toBe(422)

    // Invalid source
    const invalidSourceRes = await post(
      createRequest(validPayload({ source: 'not-valid-source' }))
    )
    expect(invalidSourceRes.status).toBe(422)
  })

  it('enforces per-IP rate limit of 10 reports/min, returning 429 on the 11th', async () => {
    const headers = { 'cf-connecting-ip': '203.0.113.42' }

    for (let i = 0; i < 10; i++) {
      const res = await post(
        createRequest(validPayload({ digest: `d-${i}` }), { headers })
      )
      expect(res.status).toBe(202)
    }

    const eleventh = await post(
      createRequest(validPayload({ digest: 'd-11' }), { headers })
    )
    expect(eleventh.status).toBe(429)
    expect(mocks.error).toHaveBeenCalledTimes(10)
  })

  it('enforces global 429 limit of 60 reports/min across different IPs without per-IP blocking global budget', async () => {
    for (let i = 1; i <= 60; i++) {
      const res = await post(
        createRequest(validPayload({ digest: `d-${i}` }), {
          headers: { 'cf-connecting-ip': `203.0.113.${i}` }
        })
      )
      expect(res.status).toBe(202)
    }

    // 61st report from a new IP hits the global limit
    const sixtyFirst = await post(
      createRequest(validPayload({ digest: 'd-61' }), {
        headers: { 'cf-connecting-ip': '203.0.113.61' }
      })
    )
    expect(sixtyFirst.status).toBe(429)
  })

  it('still counts globally when there is no trusted IP', async () => {
    mocks.trustProxy = false

    for (let i = 1; i <= 60; i++) {
      const res = await post(
        createRequest(validPayload({ digest: `no-ip-${i}` }))
      )
      expect(res.status).toBe(202)
    }

    const sixtyFirst = await post(
      createRequest(validPayload({ digest: 'no-ip-61' }))
    )
    expect(sixtyFirst.status).toBe(429)
  })

  it('never leaks request cookies or Authorization headers to logger call arguments', async () => {
    const req = createRequest(validPayload(), {
      headers: {
        Cookie: 'session=very_secret_cookie_token_123; user_auth=secret_auth',
        Authorization: 'Bearer super_secret_bearer_token_xyz'
      }
    })

    const res = await post(req)
    expect(res.status).toBe(202)

    expect(mocks.error).toHaveBeenCalledTimes(1)
    const allArgs = JSON.stringify(mocks.error.mock.calls)

    expect(allArgs).not.toContain('very_secret_cookie_token_123')
    expect(allArgs).not.toContain('secret_auth')
    expect(allArgs).not.toContain('super_secret_bearer_token_xyz')
    expect(allArgs).not.toContain('Bearer')
    expect(allArgs).not.toContain('Cookie')
  })
})

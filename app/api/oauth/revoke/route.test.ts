import { NextRequest } from 'next/server'

import { logger } from '@/lib/utils/logger'

import { POST } from './route'

const mockAuthHandler = vi.fn()

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'llun.test' }),
  getBaseURL: () => 'https://llun.test'
}))

vi.mock('@/lib/services/auth/auth', () => ({
  getAuth: () => ({ handler: mockAuthHandler })
}))

const createRequest = (body = 'token=abc&token_type_hint=access_token') =>
  new NextRequest('https://llun.test/api/oauth/revoke', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic Y2xpZW50OnNlY3JldA=='
    },
    body
  })

describe('POST /api/oauth/revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthHandler.mockResolvedValue(new Response('{}', { status: 200 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards the revocation request unchanged to better-auth and answers 200 with an empty object', async () => {
    const response = await POST(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})

    expect(mockAuthHandler).toHaveBeenCalledTimes(1)
    const proxied = mockAuthHandler.mock.calls[0][0] as Request
    expect(proxied.url).toBe('https://llun.test/api/auth/oauth2/revoke')
    expect(proxied.method).toBe('POST')
    expect(proxied.headers.get('authorization')).toBe(
      'Basic Y2xpZW50OnNlY3JldA=='
    )
    expect(proxied.headers.get('content-type')).toBe(
      'application/x-www-form-urlencoded'
    )
    await expect(proxied.text()).resolves.toBe(
      'token=abc&token_type_hint=access_token'
    )
  })

  it.each([
    [400, { error: 'invalid_request' }],
    [401, { error: 'invalid_client' }],
    [404, { error: 'not_found' }]
  ])(
    'propagates better-auth %i with its error body (RFC 7009 §2.2)',
    async (status, errorBody) => {
      mockAuthHandler.mockResolvedValue(
        new Response(JSON.stringify(errorBody), { status })
      )
      const errorSpy = vi.spyOn(logger, 'error')

      const response = await POST(createRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(status)
      await expect(response.json()).resolves.toEqual(errorBody)
      expect(errorSpy).not.toHaveBeenCalled()
    }
  )

  it('maps a 4xx status outside the supported set to 400', async () => {
    mockAuthHandler.mockResolvedValue(
      new Response(JSON.stringify({ error: 'teapot' }), { status: 418 })
    )

    const response = await POST(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'teapot' })
  })

  it('logs and propagates a better-auth 5xx', async () => {
    mockAuthHandler.mockResolvedValue(
      new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
    )
    const errorSpy = vi.spyOn(logger, 'error')

    const response = await POST(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(503)
    expect(errorSpy).toHaveBeenCalledWith({
      message: 'Token revocation failed',
      status: 503
    })
  })

  it('maps a 5xx status outside the supported set to 500', async () => {
    mockAuthHandler.mockResolvedValue(new Response('{}', { status: 502 }))

    const response = await POST(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(500)
  })

  it('falls back to an empty error body when better-auth returns a non-JSON failure', async () => {
    mockAuthHandler.mockResolvedValue(
      new Response('<html>bad gateway</html>', { status: 401 })
    )

    const response = await POST(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({})
  })

  it('answers 500 and logs when the better-auth handler throws', async () => {
    const failure = new Error('database down')
    mockAuthHandler.mockRejectedValue(failure)
    const errorSpy = vi.spyOn(logger, 'error')

    const response = await POST(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(500)
    expect(errorSpy).toHaveBeenCalledWith({
      message: 'Token revocation threw',
      error: failure
    })
  })
})

import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { POST, resetAppRegistrationWarningStateForTests } from './route'

type MockConfig = {
  secretPhase: string
  push?: { vapidPublicKey: string }
}
const mockGetConfig = vi.fn((): MockConfig => ({
  secretPhase: 'registration-pepper-secret'
}))
const mockGetTrustProxyIpHeadersConfig = vi.fn(() => false)

const hashIpRegistrationKey = (ip: string) =>
  `ip:${crypto
    .createHmac('sha256', mockGetConfig().secretPhase)
    .update(ip)
    .digest('base64url')}`

const mockCreateApplication = vi.fn()
const mockLoggerWarn = vi.fn()

vi.mock('@/lib/database', () => ({
  getDatabase: () => ({})
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

vi.mock('@/lib/config/trustProxyIpHeaders', () => ({
  getTrustProxyIpHeadersConfig: () => mockGetTrustProxyIpHeadersConfig()
}))

vi.mock('@/lib/utils/logger', () => {
  const logger = {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  return { logger }
})

vi.mock('./createApplication', () => ({
  createApplication: (...args: unknown[]) => mockCreateApplication(...args)
}))

describe('apps route', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    resetAppRegistrationWarningStateForTests()
    mockGetConfig.mockClear()
    mockGetConfig.mockReturnValue({
      secretPhase: 'registration-pepper-secret'
    })
    mockGetTrustProxyIpHeadersConfig.mockClear()
    mockGetTrustProxyIpHeadersConfig.mockReturnValue(false)
    mockCreateApplication.mockReset()
    mockLoggerWarn.mockReset()
    mockCreateApplication.mockResolvedValue({
      type: 'success',
      id: 'app-id',
      client_id: 'client-id',
      client_secret: 'client-secret',
      client_secret_expires_at: 0,
      name: 'client',
      website: null,
      scopes: ['read'],
      redirect_uri: 'https://client.llun.dev/callback',
      redirect_uris: ['https://client.llun.dev/callback']
    })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('does not derive registration limits from untrusted forwarded IP headers', async () => {
    const req = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.10',
        'x-real-ip': '203.0.113.20',
        'x-forwarded-for': '198.51.100.30, 198.51.100.40'
      },
      body: JSON.stringify({
        client_name: 'client',
        redirect_uris: 'https://client.llun.dev/callback'
      })
    })

    await POST(req)

    expect(mockCreateApplication).toHaveBeenCalledWith(expect.any(Object), {
      registrationKey: undefined
    })
    expect(mockLoggerWarn).toHaveBeenCalledWith({
      message:
        'App registration source IP is unavailable; rate limiting is disabled'
    })
  })

  test('uses the originating forwarded IP when forwarded IP headers are trusted', async () => {
    mockGetTrustProxyIpHeadersConfig.mockReturnValue(true)
    const forwardedReq = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.30, 198.51.100.40'
      },
      body: JSON.stringify({
        client_name: 'forwarded',
        redirect_uris: 'https://forwarded.llun.dev/callback'
      })
    })

    await POST(forwardedReq)

    expect(mockCreateApplication).toHaveBeenCalledWith(expect.any(Object), {
      registrationKey: hashIpRegistrationKey('198.51.100.30')
    })
    expect(mockCreateApplication).not.toHaveBeenCalledWith(expect.any(Object), {
      registrationKey: `ip:${crypto
        .createHash('sha256')
        .update('198.51.100.30')
        .digest('base64url')}`
    })
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  test('warns when no supported registration source exists', async () => {
    const directReq = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        client_name: 'direct',
        redirect_uris: 'https://direct.llun.dev/callback'
      })
    })

    await POST(directReq)

    expect(mockCreateApplication).toHaveBeenCalledWith(expect.any(Object), {
      registrationKey: undefined
    })
    expect(mockLoggerWarn).toHaveBeenCalledWith({
      message:
        'App registration source IP is unavailable; rate limiting is disabled'
    })
  })

  test('warns only once when app registration source stays unavailable', async () => {
    const createRequest = (clientName: string) =>
      new NextRequest('https://llun.test/api/v1/apps', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          client_name: clientName,
          redirect_uris: `https://${clientName}.llun.dev/callback`
        })
      })

    await POST(createRequest('first'))
    await POST(createRequest('second'))

    expect(mockCreateApplication).toHaveBeenCalledTimes(2)
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
  })

  test('accepts the Mastodon 4.3 array form of redirect_uris', async () => {
    const req = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'array-client',
        redirect_uris: [
          'https://client.llun.dev/callback',
          'https://client.llun.dev/alt-callback'
        ]
      })
    })

    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(mockCreateApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        redirect_uris: [
          'https://client.llun.dev/callback',
          'https://client.llun.dev/alt-callback'
        ]
      }),
      { registrationKey: undefined }
    )
  })

  test('includes the configured vapid_key in the registration response', async () => {
    mockGetConfig.mockReturnValue({
      secretPhase: 'registration-pepper-secret',
      push: { vapidPublicKey: 'vapid-public-key' }
    })
    const req = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'client',
        redirect_uris: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      id: 'app-id',
      client_id: 'client-id',
      client_secret: 'client-secret',
      client_secret_expires_at: 0,
      name: 'client',
      website: null,
      scopes: ['read'],
      redirect_uri: 'https://client.llun.dev/callback',
      redirect_uris: ['https://client.llun.dev/callback'],
      vapid_key: 'vapid-public-key'
    })
  })

  test('returns vapid_key null when web push is not configured', async () => {
    const req = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'client',
        redirect_uris: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)
    const body = await response.json()

    expect(body.vapid_key).toBeNull()
  })

  test('returns too many requests when app registration is throttled', async () => {
    mockCreateApplication.mockResolvedValue({
      type: 'error',
      error: 'Too many application registrations'
    })
    const req = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        client_name: 'client',
        redirect_uris: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      status: 'Too Many Requests'
    })
    expect(response.status).toBe(429)
  })

  test('redacts secrets in the logged body when registration validation fails', async () => {
    const req = new NextRequest('https://llun.test/api/v1/apps', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer super-secret-token'
      },
      // Malformed body (client_name must be a string): exercises the rejection
      // path that logs the raw, attacker-controlled payload.
      body: JSON.stringify({
        client_name: { client_secret: 'leak-me' },
        password: 'leak-me-too'
      })
    })

    const response = await POST(req)
    expect(response.status).toBe(422)

    const rejectionLog = mockLoggerWarn.mock.calls.find(
      ([payload]) =>
        (payload as { endpoint?: string }).endpoint === 'apps' &&
        (payload as { status?: number }).status === 422
    )
    expect(rejectionLog).toBeDefined()
    const [payload] = rejectionLog as [Record<string, unknown>, string]
    expect(payload.body).toEqual({
      client_name: { client_secret: '[REDACTED]' },
      password: '[REDACTED]'
    })
    expect(payload.headers).toMatchObject({
      authorization: 'Bearer [REDACTED]'
    })
  })
})

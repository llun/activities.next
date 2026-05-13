import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { POST, resetAppRegistrationWarningStateForTests } from './route'

const hashIpRegistrationKey = (ip: string) =>
  `ip:${crypto.createHash('sha256').update(ip).digest('base64url')}`

const mockCreateApplication = jest.fn()
const mockLoggerWarn = jest.fn()

jest.mock('@/lib/database', () => ({
  getDatabase: () => ({})
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args)
  }
}))

jest.mock('./createApplication', () => ({
  createApplication: (...args: unknown[]) => mockCreateApplication(...args)
}))

describe('apps route', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    resetAppRegistrationWarningStateForTests()
    mockCreateApplication.mockReset()
    mockLoggerWarn.mockReset()
    mockCreateApplication.mockResolvedValue({
      type: 'success',
      id: 'app-id',
      client_id: 'client-id',
      client_secret: 'client-secret',
      name: 'client',
      website: null,
      redirect_uri: 'https://client.llun.dev/callback'
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
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = 'true'
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
})

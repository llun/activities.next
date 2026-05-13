import { NextRequest } from 'next/server'

import { POST } from './route'

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
  beforeEach(() => {
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

  test('derives registration limits from supported forwarded IP headers', async () => {
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
      registrationKey: expect.stringMatching(/^ip:[A-Za-z0-9_-]{43}$/)
    })
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  test('uses the rightmost forwarded IP when stronger platform headers are absent', async () => {
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
      registrationKey: expect.stringMatching(/^ip:[A-Za-z0-9_-]{43}$/)
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

import { NextRequest } from 'next/server'

import { POST } from './route'

const mockAuthHandler = jest.fn()
const mockClients = new Map<string, Record<string, unknown>>()
let mockClientLookupCount = 0
let mockClientLookupError: Error | null = null

jest.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test'
  }),
  getBaseURL: () => 'https://llun.test'
}))

jest.mock('@/lib/database', () => ({
  getKnex: () => (table: string) => ({
    where: (_field: string, value: string) => ({
      first: () => {
        mockClientLookupCount += 1
        if (mockClientLookupError) return Promise.reject(mockClientLookupError)
        return Promise.resolve(
          table === 'oauthClient' ? mockClients.get(value) : null
        )
      }
    })
  })
}))

jest.mock('@/lib/services/auth/auth', () => ({
  getAuth: () => ({
    handler: mockAuthHandler
  })
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
  }
}))

describe('OAuth token endpoint', () => {
  beforeEach(() => {
    mockAuthHandler.mockReset()
    mockClients.clear()
    mockClientLookupCount = 0
    mockClientLookupError = null
  })

  test('rejects authorization-code exchanges for PKCE-required clients when code_verifier is missing', async () => {
    mockClients.set('pkce-client', {
      clientId: 'pkce-client',
      requirePKCE: true
    })
    mockAuthHandler.mockResolvedValue(
      Response.json({ access_token: 'should-not-issue' })
    )

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'pkce-client',
        client_secret: 'client-secret',
        code: 'authorization-code',
        redirect_uri: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'PKCE is required for this client'
    })
    expect(response.status).toBe(400)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  test('accepts a case-insensitive Basic auth scheme during PKCE preflight', async () => {
    mockClients.set('pkce-client', {
      clientId: 'pkce-client',
      requirePKCE: true
    })
    mockAuthHandler.mockResolvedValue(
      Response.json({ access_token: 'should-not-issue' })
    )

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `basic ${Buffer.from('pkce-client:client-secret').toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'authorization-code',
        redirect_uri: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'PKCE is required for this client'
    })
    expect(response.status).toBe(400)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  test('prefers the Basic auth client over a mismatched body client_id for PKCE preflight', async () => {
    mockClients.set('pkce-client', {
      clientId: 'pkce-client',
      requirePKCE: true
    })
    mockClients.set('non-pkce-client', {
      clientId: 'non-pkce-client',
      requirePKCE: false
    })
    mockAuthHandler.mockResolvedValue(
      Response.json({ access_token: 'should-not-issue' })
    )

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from('pkce-client:client-secret').toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'non-pkce-client',
        code: 'authorization-code',
        redirect_uri: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'PKCE is required for this client'
    })
    expect(response.status).toBe(400)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  test('falls back to the body client_id when Basic credentials omit the delimiter', async () => {
    mockClients.set('pkce-client', {
      clientId: 'pkce-client',
      requirePKCE: true
    })
    mockAuthHandler.mockResolvedValue(
      Response.json({ access_token: 'should-not-issue' })
    )

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from('malformed-client-id').toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'pkce-client',
        code: 'authorization-code',
        redirect_uri: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'PKCE is required for this client'
    })
    expect(response.status).toBe(400)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  test('falls back to the body client_id when Basic credentials are not valid base64', async () => {
    mockClients.set('pkce-client', {
      clientId: 'pkce-client',
      requirePKCE: true
    })
    mockClients.set('shadow-client', {
      clientId: 'shadow-client',
      requirePKCE: false
    })
    mockAuthHandler.mockResolvedValue(
      Response.json({ access_token: 'should-not-issue' })
    )

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from('shadow-client:client-secret').toString('base64')}!`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'pkce-client',
        code: 'authorization-code',
        redirect_uri: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'PKCE is required for this client'
    })
    expect(response.status).toBe(400)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  test('rejects authorization-code exchanges without client credentials before proxying', async () => {
    mockAuthHandler.mockResolvedValue(
      Response.json({ access_token: 'should-not-issue' })
    )

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'authorization-code',
        redirect_uri: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'invalid_client'
    })
    expect(response.status).toBe(401)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  test('normalizes token request content type before PKCE validation', async () => {
    mockClients.set('pkce-client', {
      clientId: 'pkce-client',
      requirePKCE: true
    })
    mockAuthHandler.mockResolvedValue(
      Response.json({ access_token: 'should-not-issue' })
    )

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'Application/X-WWW-Form-Urlencoded; Charset=UTF-8'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'pkce-client',
        client_secret: 'client-secret',
        code: 'authorization-code',
        redirect_uri: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'PKCE is required for this client'
    })
    expect(response.status).toBe(400)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  test('rejects token requests that are not form encoded before proxying', async () => {
    mockAuthHandler.mockResolvedValue(
      Response.json({ access_token: 'should-not-issue' })
    )

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: 'pkce-client',
        code: 'authorization-code'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description:
        'Token requests must use application/x-www-form-urlencoded'
    })
    expect(response.status).toBe(400)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  test('does not look up the client during PKCE preflight when code_verifier is present', async () => {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'pkce-client',
      client_secret: 'client-secret',
      code: 'authorization-code',
      code_verifier: 'valid-code-verifier',
      redirect_uri: 'https://client.llun.dev/callback'
    })
    mockAuthHandler.mockImplementation(async (request: Request) => {
      await expect(request.text()).resolves.toBe(body.toString())
      return Response.json({ access_token: 'issued' })
    })

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      access_token: 'issued',
      created_at: expect.any(Number)
    })
    expect(response.status).toBe(200)
    expect(mockClientLookupCount).toBe(0)
    expect(mockAuthHandler).toHaveBeenCalled()
  })

  test('filters destination-conflicting headers before proxying to the auth handler', async () => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'client-id',
      client_secret: 'client-secret'
    })
    mockAuthHandler.mockImplementation(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer original')
      expect(request.headers.get('content-type')).toBe(
        'application/x-www-form-urlencoded'
      )
      expect(request.headers.has('host')).toBe(false)
      expect(request.headers.has('content-length')).toBe(false)
      await expect(request.text()).resolves.toBe(body.toString())
      return Response.json({ access_token: 'issued' })
    })

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: {
        authorization: 'Bearer original',
        'content-type': 'application/x-www-form-urlencoded',
        host: 'llun.test',
        'content-length': '999'
      },
      body
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      access_token: 'issued',
      created_at: expect.any(Number)
    })
    expect(response.status).toBe(200)
    expect(mockAuthHandler).toHaveBeenCalled()
  })

  test('returns OAuth server_error when PKCE preflight fails internally', async () => {
    mockClientLookupError = new Error('database unavailable')

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'pkce-client',
        client_secret: 'client-secret',
        code: 'authorization-code',
        redirect_uri: 'https://client.llun.dev/callback'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'server_error'
    })
    expect(response.status).toBe(500)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  test('rejects oversized token bodies before buffering them for PKCE checks', async () => {
    mockAuthHandler.mockResolvedValue(
      Response.json({ access_token: 'should-not-issue' })
    )

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '65537'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'pkce-client',
        code: 'authorization-code'
      })
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'Request body is too large'
    })
    expect(response.status).toBe(413)
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })

  test('rejects token bodies that cannot be read with a bounded stream', async () => {
    mockAuthHandler.mockResolvedValue(
      Response.json({ access_token: 'should-not-issue' })
    )

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Origin: 'https://client.llun.dev'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'client-id',
        client_secret: 'client-secret'
      })
    })
    const arrayBufferSpy = jest.spyOn(req, 'arrayBuffer')
    Object.defineProperty(req, 'body', {
      value: {},
      configurable: true
    })

    const response = await POST(req)

    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'Unable to read request body'
    })
    expect(response.status).toBe(400)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://client.llun.dev'
    )
    expect(arrayBufferSpy).not.toHaveBeenCalled()
    expect(mockAuthHandler).not.toHaveBeenCalled()
  })
})

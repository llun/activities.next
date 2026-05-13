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
    mockAuthHandler.mockResolvedValue(Response.json({ access_token: 'issued' }))

    const req = new NextRequest('https://llun.test/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'pkce-client',
        client_secret: 'client-secret',
        code: 'authorization-code',
        code_verifier: 'valid-code-verifier',
        redirect_uri: 'https://client.llun.dev/callback'
      })
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
})

import { NextRequest } from 'next/server'

import { POST } from './route'

const mockAuthHandler = jest.fn()
const mockClients = new Map<string, Record<string, unknown>>()

jest.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test'
  }),
  getBaseURL: () => 'https://llun.test'
}))

jest.mock('@/lib/database', () => ({
  getKnex: () => (table: string) => ({
    where: (_field: string, value: string) => ({
      first: () =>
        Promise.resolve(table === 'oauthClient' ? mockClients.get(value) : null)
    })
  })
}))

jest.mock('@/lib/services/auth/auth', () => ({
  getAuth: () => ({
    handler: mockAuthHandler
  })
}))

describe('OAuth token endpoint', () => {
  beforeEach(() => {
    mockAuthHandler.mockReset()
    mockClients.clear()
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
})

import { NextRequest } from 'next/server'

import { getServerAuthSession } from '@/lib/services/auth/getSession'

import { PATCH } from './route'

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({ host: 'llun.test' })
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null)
}))

const mockDatabase = { updateActor: vi.fn() }
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('PATCH /api/v1/accounts/profile without a session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const patch = (headers: Record<string, string> = {}) =>
    PATCH(
      new NextRequest('https://llun.test/api/v1/accounts/profile', {
        method: 'PATCH',
        headers: {
          origin: 'https://llun.test',
          'content-type': 'application/json',
          ...headers
        },
        body: JSON.stringify({ name: 'Someone else' })
      }),
      { params: Promise.resolve({}) }
    )

  it('sends a signed-out caller to sign in and writes nothing', async () => {
    const response = await patch()

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/auth/signin')
    expect(mockDatabase.updateActor).not.toHaveBeenCalled()
  })

  it('refuses a cross-site request before reading the session', async () => {
    const response = await patch({ origin: 'https://evil.example' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(getServerAuthSession).not.toHaveBeenCalled()
    expect(mockDatabase.updateActor).not.toHaveBeenCalled()
  })
})

import { NextRequest } from 'next/server'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => ({})
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: []
  })
}))

const { POST } = await import('./route')

describe('POST /api/v1/actors/delete', () => {
  it('does not read or clone the body of an unauthenticated request', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const req = new NextRequest('https://llun.test/api/v1/actors/delete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: JSON.stringify({ actorId: 'x'.repeat(100_000) })
    })
    const cloneSpy = vi.spyOn(req, 'clone')

    const response = await POST(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(307)
    expect(cloneSpy).not.toHaveBeenCalled()
    expect(req.bodyUsed).toBe(false)
  })
})

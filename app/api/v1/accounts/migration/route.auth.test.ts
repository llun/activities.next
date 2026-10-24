import { NextRequest } from 'next/server'

import { DELETE, GET, POST } from './route'

vi.mock('@/lib/services/guards/sameOriginProof', () => ({
  hasSameOriginProof: () => true
}))
vi.mock('@/lib/database', () => ({ getDatabase: vi.fn(() => ({})) }))
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null)
}))

describe('Account migration API route, unauthenticated', () => {
  const ctx = { params: Promise.resolve({}) }
  const request = (method: string) =>
    new NextRequest('https://llun.test/api/v1/accounts/migration', {
      method,
      headers: { origin: 'https://llun.test' }
    })

  it.each([
    ['GET', GET],
    ['POST', POST],
    ['DELETE', DELETE]
  ])(
    'redirects %s to sign in without touching anything',
    async (method, handler) => {
      const res = await handler(request(method), ctx)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/auth/signin')
    }
  )
})

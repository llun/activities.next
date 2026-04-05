import { NextRequest } from 'next/server'

import { GET } from './route'

const mockGetConfig = jest.fn()
jest.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

describe('GET /api/v1/push/vapid-key', () => {
  it('returns 404 when push is not configured', async () => {
    mockGetConfig.mockReturnValue({ host: 'llun.test' })

    const req = new NextRequest('http://localhost/api/v1/push/vapid-key')
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(404)
  })

  it('returns vapid public key when push is configured', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      push: {
        vapidPublicKey: 'test-public-key',
        vapidPrivateKey: 'test-private-key',
        vapidEmail: 'admin@example.com'
      }
    })

    const req = new NextRequest('http://localhost/api/v1/push/vapid-key')
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.vapidPublicKey).toBe('test-public-key')
  })
})

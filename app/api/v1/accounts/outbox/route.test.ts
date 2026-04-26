import { NextRequest } from 'next/server'

import { seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE, POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

jest.mock('@/lib/database', () => ({
  getDatabase: () => ({})
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn().mockResolvedValue(seedActor1)
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('POST /api/v1/accounts/outbox', () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' }
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/v1/accounts/outbox', () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts/outbox', {
      method: 'DELETE',
      body: '{',
      headers: { 'Content-Type': 'application/json' }
    })

    const res = await DELETE(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(400)
  })
})

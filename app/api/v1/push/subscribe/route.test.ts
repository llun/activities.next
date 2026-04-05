import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE, POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: []
  })
}))

type MockDatabase = Pick<
  Database,
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getActorFromId'
  | 'createPushSubscription'
  | 'deletePushSubscription'
>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

const endpoint = 'https://push.example.com/endpoint/test'
const p256dh = 'test-p256dh-key'
const auth = 'test-auth-key'

describe('POST /api/v1/push/subscribe', () => {
  beforeEach(() => {
    mockDatabase = {
      getAccountFromEmail: jest.fn().mockResolvedValue({
        id: 'account1',
        email: 'test@example.com'
      }),
      getActorsForAccount: jest
        .fn()
        .mockResolvedValue([{ ...seedActor1, id: ACTOR1_ID }]),
      getActorFromId: jest
        .fn()
        .mockResolvedValue({ ...seedActor1, id: ACTOR1_ID }),
      createPushSubscription: jest.fn().mockResolvedValue({
        id: 'sub1',
        actorId: ACTOR1_ID,
        endpoint,
        p256dh,
        auth,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }),
      deletePushSubscription: jest.fn().mockResolvedValue(undefined)
    }

    mockGetServerSession.mockResolvedValue({
      user: { email: 'test@example.com' }
    })
  })

  it('returns 400 for invalid body', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ invalid: true }),
      headers: { 'Content-Type': 'application/json' }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it('creates subscription and returns id', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint,
        keys: { p256dh, auth }
      }),
      headers: { 'Content-Type': 'application/json' }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('sub1')
  })
})

describe('DELETE /api/v1/push/subscribe', () => {
  beforeEach(() => {
    mockDatabase = {
      getAccountFromEmail: jest.fn().mockResolvedValue({
        id: 'account1',
        email: 'test@example.com'
      }),
      getActorsForAccount: jest
        .fn()
        .mockResolvedValue([{ ...seedActor1, id: ACTOR1_ID }]),
      getActorFromId: jest
        .fn()
        .mockResolvedValue({ ...seedActor1, id: ACTOR1_ID }),
      createPushSubscription: jest.fn(),
      deletePushSubscription: jest.fn().mockResolvedValue(undefined)
    }

    mockGetServerSession.mockResolvedValue({
      user: { email: 'test@example.com' }
    })
  })

  it('returns 400 for invalid body', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ bad: 'data' }),
      headers: { 'Content-Type': 'application/json' }
    })
    const res = await DELETE(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it('deletes subscription and returns OK', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
      headers: { 'Content-Type': 'application/json' }
    })
    const res = await DELETE(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('OK')
    expect(mockDatabase!.deletePushSubscription).toHaveBeenCalledWith({
      endpoint,
      actorId: ACTOR1_ID
    })
  })
})

import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { Scope } from '@/lib/types/database/operations'

import { DELETE, GET, POST, PUT } from './route'

const mockOAuthGuard = jest.fn()
const mockCurrentActor = { ...seedActor1, id: ACTOR1_ID }

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: [],
    push: { vapidPublicKey: 'test-vapid-public-key' }
  })
}))

type MockDatabase = Pick<
  Database,
  | 'createPushSubscription'
  | 'updatePushSubscription'
  | 'deletePushSubscription'
  | 'getPushSubscriptionForActor'
>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      scopes: Scope[],
      handle: (
        req: NextRequest,
        context: {
          currentActor: typeof mockCurrentActor
          database: MockDatabase
          params: Promise<{}>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) => {
      mockOAuthGuard(scopes, handle)
      return handle(req, {
        currentActor: mockCurrentActor,
        database: mockDatabase!,
        params: context.params
      })
    }
}))

const endpoint = 'https://push.example.com/endpoint/test'
const p256dh = 'test-p256dh-key'
const auth = 'test-auth-key'

const storedSubscription = {
  id: 'sub1',
  actorId: ACTOR1_ID,
  endpoint,
  p256dh,
  auth,
  alerts: {
    mention: true,
    status: false,
    reblog: true,
    follow: true,
    follow_request: false,
    favourite: true,
    poll: true,
    update: false,
    quote: false,
    quoted_update: false,
    'admin.sign_up': false,
    'admin.report': false
  },
  policy: 'all' as const,
  standard: false,
  createdAt: Date.now(),
  updatedAt: Date.now()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDatabase = {
    createPushSubscription: jest.fn().mockResolvedValue(storedSubscription),
    updatePushSubscription: jest.fn().mockResolvedValue(storedSubscription),
    deletePushSubscription: jest.fn().mockResolvedValue(undefined),
    getPushSubscriptionForActor: jest.fn().mockResolvedValue(storedSubscription)
  }
})

describe('POST /api/v1/push/subscription', () => {
  it('uses the push scope', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscription', {
      method: 'POST',
      body: JSON.stringify({
        subscription: { endpoint, keys: { p256dh, auth } },
        data: { alerts: { mention: true }, policy: 'all' }
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      }
    })
    await POST(req, { params: Promise.resolve({}) })
    expect(mockOAuthGuard).toHaveBeenCalledWith(
      [Scope.enum.push],
      expect.any(Function)
    )
  })

  it('returns 422 for invalid body', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscription', {
      method: 'POST',
      body: JSON.stringify({ subscription: { endpoint } }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(422)
  })

  it('creates a subscription and returns the WebPushSubscription shape', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscription', {
      method: 'POST',
      body: JSON.stringify({
        subscription: { endpoint, keys: { p256dh, auth }, standard: true },
        data: { alerts: { mention: true }, policy: 'followed' }
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      id: 'sub1',
      endpoint,
      standard: false,
      alerts: storedSubscription.alerts,
      server_key: 'test-vapid-public-key'
    })
    expect(mockDatabase!.createPushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR1_ID,
        endpoint,
        p256dh,
        auth,
        standard: true,
        policy: 'followed'
      })
    )
  })

})

describe('GET /api/v1/push/subscription', () => {
  it('returns the current subscription', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscription')
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('sub1')
    expect(body.server_key).toBe('test-vapid-public-key')
  })

  it('returns 404 when there is no subscription', async () => {
    mockDatabase!.getPushSubscriptionForActor = jest
      .fn()
      .mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/v1/push/subscription')
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/v1/push/subscription', () => {
  it('updates preferences and returns the subscription', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscription', {
      method: 'PUT',
      body: JSON.stringify({ data: { alerts: { mention: false } } }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      }
    })
    const res = await PUT(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(mockDatabase!.updatePushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR1_ID })
    )
  })

  it('returns 404 when there is no subscription to update', async () => {
    mockDatabase!.updatePushSubscription = jest.fn().mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/v1/push/subscription', {
      method: 'PUT',
      body: JSON.stringify({ data: { policy: 'none' } }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      }
    })
    const res = await PUT(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/push/subscription', () => {
  it('removes the subscription and returns an empty object', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscription', {
      method: 'DELETE',
      headers: { Origin: 'http://localhost' }
    })
    const res = await DELETE(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({})
    expect(mockDatabase!.deletePushSubscription).toHaveBeenCalledWith({
      endpoint,
      actorId: ACTOR1_ID
    })
  })

  it('returns an empty object even without an existing subscription', async () => {
    mockDatabase!.getPushSubscriptionForActor = jest
      .fn()
      .mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/v1/push/subscription', {
      method: 'DELETE',
      headers: { Origin: 'http://localhost' }
    })
    const res = await DELETE(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(mockDatabase!.deletePushSubscription).not.toHaveBeenCalled()
  })
})

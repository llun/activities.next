import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { Scope } from '@/lib/types/database/operations'

import { DELETE, POST } from './route'

const mockGetServerSession = vi.fn()
const mockOAuthGuard = vi.fn()
const mockCurrentActor = { ...seedActor1, id: ACTOR1_ID }
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({
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
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  // Mirror the real parser in OAuthGuard.ts exactly (trim + split on \s+,
  // require exactly two parts, case-insensitive scheme) so the route tests
  // exercise the same token-extraction behavior as production.
  getTokenFromHeader: (header: string | null) => {
    if (!header) return null
    const parts = header.trim().split(/\s+/)
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null
    return parts[1] || null
  },
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

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

const endpoint = 'https://push.example.com/endpoint/test'
const p256dh = 'test-p256dh-key'
const auth = 'test-auth-key'

describe('POST /api/v1/push/subscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = {
      getAccountFromEmail: vi.fn().mockResolvedValue({
        id: 'account1',
        email: 'test@example.com'
      }),
      getActorsForAccount: vi
        .fn()
        .mockResolvedValue([{ ...seedActor1, id: ACTOR1_ID }]),
      getActorFromId: vi
        .fn()
        .mockResolvedValue({ ...seedActor1, id: ACTOR1_ID }),
      createPushSubscription: vi.fn().mockResolvedValue({
        id: 'sub1',
        actorId: ACTOR1_ID,
        endpoint,
        p256dh,
        auth,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }),
      deletePushSubscription: vi.fn().mockResolvedValue(undefined)
    }

    mockGetServerSession.mockResolvedValue({
      user: { email: 'test@example.com' }
    })
  })

  it('returns 400 for invalid body', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ invalid: true }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(mockOAuthGuard).toHaveBeenCalledWith(
      [Scope.enum.push],
      expect.any(Function)
    )
  })

  it('creates subscription and returns id', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint,
        keys: { p256dh, auth }
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('sub1')
    // Legacy subscriptions enable every alert and use the standard aes128gcm
    // encoding, so delivery (which now honors per-subscription alerts and the
    // standard flag) keeps sending them all notifications as before.
    expect(mockDatabase!.createPushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        alerts: expect.objectContaining({ mention: true, favourite: true }),
        standard: true
      })
    )
  })
})

describe('DELETE /api/v1/push/subscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = {
      getAccountFromEmail: vi.fn().mockResolvedValue({
        id: 'account1',
        email: 'test@example.com'
      }),
      getActorsForAccount: vi
        .fn()
        .mockResolvedValue([{ ...seedActor1, id: ACTOR1_ID }]),
      getActorFromId: vi
        .fn()
        .mockResolvedValue({ ...seedActor1, id: ACTOR1_ID }),
      createPushSubscription: vi.fn(),
      deletePushSubscription: vi.fn().mockResolvedValue(undefined)
    }

    mockGetServerSession.mockResolvedValue({
      user: { email: 'test@example.com' }
    })
  })

  it('returns 400 for invalid body', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ bad: 'data' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      }
    })
    const res = await DELETE(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(mockOAuthGuard).toHaveBeenCalledWith(
      [Scope.enum.push],
      expect.any(Function)
    )
  })

  it('deletes subscription and returns OK', async () => {
    const req = new NextRequest('http://localhost/api/v1/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      }
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

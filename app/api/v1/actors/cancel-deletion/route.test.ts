import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
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
  | 'getActorDeletionStatus'
  | 'cancelActorDeletion'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const account = {
  id: 'account-1',
  email: seedActor1.email,
  defaultActorId: ACTOR1_ID
}

const actorA = {
  ...seedActor1,
  id: 'actor-a',
  username: 'actor_a',
  account
}

const actorB = {
  ...seedActor1,
  id: 'actor-b',
  username: 'actor_b',
  account,
  deletionStatus: 'scheduled' as const,
  deletionScheduledAt: new Date(Date.now() + 86400000)
}

const buildRequest = (body: unknown, origin: string = 'https://llun.test') =>
  new NextRequest('http://llun.test/api/v1/actors/cancel-deletion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin
    },
    body: JSON.stringify(body)
  })

describe('POST /api/v1/actors/cancel-deletion', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    getActorDeletionStatus: vi.fn(),
    cancelActorDeletion: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email },
      session: { token: 'current-token' }
    })
    mockDb.getAccountFromEmail.mockResolvedValue(account as never)
    mockDb.getActorsForAccount.mockResolvedValue([actorA, actorB] as never)
    mockDb.getActorDeletionStatus.mockResolvedValue({
      status: 'scheduled',
      scheduledAt: Date.now()
    } as never)
    mockDb.cancelActorDeletion.mockResolvedValue(undefined)
  })

  it('cancels scheduled deletion for an owned actor', async () => {
    const response = await POST(buildRequest({ actorId: 'actor-b' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      actorId: 'actor-b',
      status: 'cancelled'
    })
    expect(mockDb.cancelActorDeletion).toHaveBeenCalledWith({
      actorId: 'actor-b'
    })
  })

  it('cancels deletion of actor B even when actor A is suspended', async () => {
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...actorA, suspendedAt: Date.now() },
      actorB
    ] as never)

    const response = await POST(buildRequest({ actorId: 'actor-b' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      actorId: 'actor-b',
      status: 'cancelled'
    })
    expect(mockDb.cancelActorDeletion).toHaveBeenCalledWith({
      actorId: 'actor-b'
    })
  })

  it('cancels deletion of actor B when the account is disabled', async () => {
    mockDb.getAccountFromEmail.mockResolvedValue({
      ...account,
      disabledAt: Date.now()
    } as never)

    const response = await POST(buildRequest({ actorId: 'actor-b' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      actorId: 'actor-b',
      status: 'cancelled'
    })
    expect(mockDb.cancelActorDeletion).toHaveBeenCalledWith({
      actorId: 'actor-b'
    })
  })

  it('returns 403 when account confirmation is pending', async () => {
    mockDb.getAccountFromEmail.mockResolvedValue({
      ...account,
      verificationCode: 'pending-code',
      emailVerified: false
    } as never)

    const response = await POST(buildRequest({ actorId: 'actor-b' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockDb.cancelActorDeletion).not.toHaveBeenCalled()
  })

  it('returns 403 when CSRF same-origin proof is missing', async () => {
    const req = new NextRequest(
      'http://llun.test/api/v1/actors/cancel-deletion',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ actorId: 'actor-b' })
      }
    )

    const response = await POST(req, {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(403)
    expect(mockDb.cancelActorDeletion).not.toHaveBeenCalled()
  })

  it('returns 404 when actor is not owned by the account', async () => {
    const response = await POST(buildRequest({ actorId: 'actor-other' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Actor not found or not owned by account'
    })
    expect(mockDb.cancelActorDeletion).not.toHaveBeenCalled()
  })

  it('returns 400 when actor is not scheduled for deletion', async () => {
    mockDb.getActorDeletionStatus.mockResolvedValue(null as never)

    const response = await POST(buildRequest({ actorId: 'actor-b' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Actor is not scheduled for deletion'
    })
    expect(mockDb.cancelActorDeletion).not.toHaveBeenCalled()
  })

  it('returns 400 when actor deletion is already in progress', async () => {
    mockDb.getActorDeletionStatus.mockResolvedValue({
      status: 'deleting',
      scheduledAt: Date.now()
    } as never)

    const response = await POST(buildRequest({ actorId: 'actor-b' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot cancel deletion that is already in progress'
    })
    expect(mockDb.cancelActorDeletion).not.toHaveBeenCalled()
  })

  it('returns 400 when request body is invalid', async () => {
    const response = await POST(buildRequest({}), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request body'
    })
    expect(mockDb.cancelActorDeletion).not.toHaveBeenCalled()
  })

  it('returns 401 when no session exists', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await POST(buildRequest({ actorId: 'actor-b' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
    expect(mockDb.cancelActorDeletion).not.toHaveBeenCalled()
  })

  it('returns 401 when account cannot be resolved from session', async () => {
    mockDb.getAccountFromEmail.mockResolvedValue(null as never)

    const response = await POST(buildRequest({ actorId: 'actor-b' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
    expect(mockDb.cancelActorDeletion).not.toHaveBeenCalled()
  })
})

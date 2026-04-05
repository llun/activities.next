import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

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
  | 'getActorSettings'
  | 'updateActor'
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

const actor = { ...seedActor1, id: ACTOR1_ID }

describe('POST /api/v1/accounts/email-notifications', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: jest.fn(),
    getActorsForAccount: jest.fn(),
    getActorFromId: jest.fn(),
    getActorSettings: jest.fn(),
    updateActor: jest.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockDb.getAccountFromEmail.mockResolvedValue({
      id: 'account1',
      email: seedActor1.email,
      defaultActorId: ACTOR1_ID
    })
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.getActorFromId.mockResolvedValue(actor)
    mockDb.getActorSettings.mockResolvedValue(null)
    mockDb.updateActor.mockResolvedValue(undefined as never)
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/accounts/email-notifications',
      {
        method: 'POST',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json' }
      }
    )
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it('returns 400 for body failing schema validation', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/accounts/email-notifications',
      {
        method: 'POST',
        body: JSON.stringify({ like: 'yes' }), // should be boolean
        headers: { 'Content-Type': 'application/json' }
      }
    )
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })

  it('updates settings for current actor and returns OK', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/accounts/email-notifications',
      {
        method: 'POST',
        body: JSON.stringify({ like: true, follow: false }),
        headers: { 'Content-Type': 'application/json' }
      }
    )
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('OK')
    expect(mockDb.updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR1_ID,
        emailNotifications: { like: true, follow: false }
      })
    )
  })

  it('merges with existing settings when updating', async () => {
    mockDb.getActorSettings.mockResolvedValue({
      emailNotifications: { like: true, mention: true }
    } as never)

    const req = new NextRequest(
      'http://localhost/api/v1/accounts/email-notifications',
      {
        method: 'POST',
        body: JSON.stringify({ like: false }),
        headers: { 'Content-Type': 'application/json' }
      }
    )
    await POST(req, { params: Promise.resolve({}) })
    expect(mockDb.updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        emailNotifications: { like: false, mention: true }
      })
    )
  })

  it('supports activity_import notification type', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/accounts/email-notifications',
      {
        method: 'POST',
        body: JSON.stringify({ activity_import: false }),
        headers: { 'Content-Type': 'application/json' }
      }
    )
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(mockDb.updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        emailNotifications: { activity_import: false }
      })
    )
  })

  it('returns 403 when targeting an actor not owned by current user', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/accounts/email-notifications',
      {
        method: 'POST',
        body: JSON.stringify({
          actorId: 'https://other.test/users/someone',
          like: true
        }),
        headers: { 'Content-Type': 'application/json' }
      }
    )
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
  })
})

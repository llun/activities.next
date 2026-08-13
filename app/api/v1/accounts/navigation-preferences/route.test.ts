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
  | 'getActorFromId'
  | 'getActorSettings'
  | 'updateActor'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

const actor = { ...seedActor1, id: ACTOR1_ID }

const buildRequest = (body: string) =>
  new NextRequest('http://localhost/api/v1/accounts/navigation-preferences', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://llun.test'
    }
  })

describe('POST /api/v1/accounts/navigation-preferences', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    getActorFromId: vi.fn(),
    getActorSettings: vi.fn(),
    updateActor: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
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
    const res = await POST(buildRequest('not-json'), {
      params: Promise.resolve({})
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for body failing schema validation', async () => {
    const res = await POST(
      buildRequest(JSON.stringify({ navOrder: 'search' })),
      {
        params: Promise.resolve({})
      }
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for an empty body without persisting', async () => {
    const res = await POST(buildRequest(JSON.stringify({})), {
      params: Promise.resolve({})
    })
    expect(res.status).toBe(400)
    expect(mockDb.updateActor).not.toHaveBeenCalled()
  })

  it('persists the navigation for the current actor', async () => {
    const res = await POST(
      buildRequest(
        JSON.stringify({
          navOrder: ['settings', 'timeline'],
          navHidden: ['favorites']
        })
      ),
      { params: Promise.resolve({}) }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('OK')
    expect(mockDb.updateActor).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      navOrder: ['settings', 'timeline'],
      navHidden: ['favorites']
    })
  })

  it('drops ids this release does not know', async () => {
    await POST(
      buildRequest(
        JSON.stringify({
          navOrder: ['timeline', 'trends', 'timeline'],
          navHidden: ['favorites', 'trends']
        })
      ),
      { params: Promise.resolve({}) }
    )

    expect(mockDb.updateActor).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      navOrder: ['timeline'],
      navHidden: ['favorites']
    })
  })

  it('refuses to hide a pinned item', async () => {
    await POST(
      buildRequest(JSON.stringify({ navHidden: ['settings', 'bookmarks'] })),
      { params: Promise.resolve({}) }
    )

    expect(mockDb.updateActor).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      navHidden: ['bookmarks']
    })
  })

  it('accepts empty lists as a reset to the shipped navigation', async () => {
    const res = await POST(
      buildRequest(JSON.stringify({ navOrder: [], navHidden: [] })),
      { params: Promise.resolve({}) }
    )

    expect(res.status).toBe(200)
    expect(mockDb.updateActor).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      navOrder: [],
      navHidden: []
    })
  })

  it('accepts an update to one half of the navigation', async () => {
    await POST(buildRequest(JSON.stringify({ navHidden: ['bookmarks'] })), {
      params: Promise.resolve({})
    })

    expect(mockDb.updateActor).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      navHidden: ['bookmarks']
    })
  })
})

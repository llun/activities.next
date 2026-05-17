import { NextRequest } from 'next/server'

import { GET } from './route'

const mockDatabase = {
  searchAccounts: jest.fn()
}
const mockCurrentActor = { id: 'actor-1' }

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      scopes: string[],
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<Record<string, never>>
        }
      ) => Promise<Response>
    ) =>
    (req: NextRequest) => {
      expect(scopes).toEqual(['read', 'read:search'])
      return handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: Promise.resolve({})
      })
    }
}))

describe('GET /api/v1/accounts/search', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase.searchAccounts.mockResolvedValue([
      { id: '1', acct: 'alice@local.test' }
    ])
  })

  it('returns partial account search results from the shared search index', async () => {
    const response = await GET(
      new NextRequest(
        'https://local.test/api/v1/accounts/search?q=ali&limit=5&offset=2'
      )
    )

    await expect(response.json()).resolves.toEqual([
      { id: '1', acct: 'alice@local.test' }
    ])
    expect(mockDatabase.searchAccounts).toHaveBeenCalledWith({
      query: 'ali',
      limit: 5,
      offset: 2,
      currentActorId: 'actor-1',
      following: false,
      resolve: false
    })
  })

  it('passes the following filter through to account search', async () => {
    await GET(
      new NextRequest(
        'https://local.test/api/v1/accounts/search?q=ali&following=true'
      )
    )

    expect(mockDatabase.searchAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        currentActorId: 'actor-1',
        following: true
      })
    )
  })

  it('rejects queries longer than 500 characters', async () => {
    const response = await GET(
      new NextRequest(
        `https://local.test/api/v1/accounts/search?q=${'a'.repeat(501)}`
      )
    )

    expect(response.status).toBe(400)
    expect(mockDatabase.searchAccounts).not.toHaveBeenCalled()
  })
})

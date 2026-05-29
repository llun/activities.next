import { NextRequest } from 'next/server'

import { GET } from './route'

const mockDatabase = {
  getNotificationsForGroupKey: jest.fn(),
  getMastodonActorsFromIds: jest.fn()
}

const mockCurrentActor = { id: 'https://llun.test/users/llun' }

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          currentActor: typeof mockCurrentActor
          params: Promise<{ group_key: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ group_key: string }> }) =>
      handle(req, { currentActor: mockCurrentActor, params: context.params })
}))

describe('GET /api/v2/notifications/:group_key/accounts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 404 when group key is not found', async () => {
    mockDatabase.getNotificationsForGroupKey.mockResolvedValueOnce([])

    const request = new NextRequest(
      'https://llun.test/api/v2/notifications/unknown:group/accounts',
      { method: 'GET' }
    )
    const response = await GET(request, {
      params: Promise.resolve({ group_key: 'unknown:group' })
    })

    expect(response.status).toBe(404)
    expect(mockDatabase.getMastodonActorsFromIds).not.toHaveBeenCalled()
  })

  it('returns deduped accounts for a group key', async () => {
    const ALICE = 'https://other.test/users/alice'
    const BOB = 'https://other.test/users/bob'
    mockDatabase.getNotificationsForGroupKey.mockResolvedValueOnce([
      { id: 'n1', sourceActorId: ALICE },
      { id: 'n2', sourceActorId: BOB },
      { id: 'n3', sourceActorId: ALICE }
    ])
    mockDatabase.getMastodonActorsFromIds.mockImplementation(
      ({ ids }: { ids: string[] }) => Promise.resolve(ids.map((id) => ({ id })))
    )

    const request = new NextRequest(
      'https://llun.test/api/v2/notifications/like%3As1/accounts',
      { method: 'GET' }
    )
    const response = await GET(request, {
      params: Promise.resolve({ group_key: 'like:s1' })
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    // ALICE appears twice but is deduped
    expect(data).toHaveLength(2)
    expect(
      (mockDatabase.getMastodonActorsFromIds as jest.Mock).mock.calls[0][0].ids
    ).toEqual([ALICE, BOB])
  })
})

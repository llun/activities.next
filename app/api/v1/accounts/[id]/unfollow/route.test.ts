import { NextRequest } from 'next/server'

import { unfollow } from '@/lib/activities'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockDatabase = {
  getAcceptedOrRequestedFollow: vi.fn(),
  getActorFromId: vi.fn(),
  updateFollowStatus: vi.fn()
}
const mockCurrentActor = {
  id: 'https://llun.test/users/llun',
  domain: 'llun.test'
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

vi.mock('@/lib/activities', () => ({
  unfollow: vi.fn()
}))

vi.mock('@/lib/services/accounts/relationship', () => ({
  getRelationship: vi.fn()
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn().mockResolvedValue(true)
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(undefined)
}))

const TARGET = 'https://remote.test/users/alice'

const createRequest = (targetActorId: string) =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/${urlToId(targetActorId)}/unfollow`,
    { method: 'POST' }
  )

describe('POST /api/v1/accounts/:id/unfollow', () => {
  const getRelationshipMock = vi.mocked(getRelationship)
  const unfollowMock = vi.mocked(unfollow)

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    mockDatabase.getActorFromId.mockResolvedValue({ id: TARGET })
    getRelationshipMock.mockResolvedValue({
      id: 'target',
      following: false
    } as never)
  })

  it('returns 404 for an unknown target instead of an all-false relationship', async () => {
    mockDatabase.getActorFromId.mockResolvedValue(null)

    const response = await POST(createRequest(TARGET), {
      params: Promise.resolve({ id: urlToId(TARGET) })
    })

    expect(response.status).toBe(404)
    expect(getRelationshipMock).not.toHaveBeenCalled()
  })

  it('returns the relationship for a known target that is not followed', async () => {
    const response = await POST(createRequest(TARGET), {
      params: Promise.resolve({ id: urlToId(TARGET) })
    })

    expect(response.status).toBe(200)
    expect(unfollowMock).not.toHaveBeenCalled()
    expect(getRelationshipMock).toHaveBeenCalledWith({
      database: mockDatabase,
      currentActor: mockCurrentActor,
      targetActorId: TARGET
    })
  })

  it('undoes an existing follow', async () => {
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
      id: 'follow-1',
      actorId: mockCurrentActor.id,
      targetActorId: TARGET
    })

    const response = await POST(createRequest(TARGET), {
      params: Promise.resolve({ id: urlToId(TARGET) })
    })

    expect(response.status).toBe(200)
    expect(mockDatabase.updateFollowStatus).toHaveBeenCalledWith({
      followId: 'follow-1',
      status: 'Undo'
    })
  })
})

import { NextRequest } from 'next/server'

import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockCurrentActor = {
  id: 'https://llun.test/users/me',
  domain: 'llun.test'
}
const mockDatabase = {
  getAcceptedOrRequestedFollow: vi.fn(),
  getActorFromId: vi.fn(),
  updateFollowStatus: vi.fn()
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (_scopes: unknown, handle: (req: NextRequest, ctx: unknown) => unknown) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        currentActor: mockCurrentActor,
        database: mockDatabase,
        params: context.params
      }),
  corsErrorResponse: () => () => new Response(null)
}))

const getRelationship = vi.fn()
vi.mock('@/lib/services/accounts/relationship', () => ({
  getRelationship: (params: unknown) => getRelationship(params)
}))

vi.mock('@/lib/activities', () => ({ rejectFollow: vi.fn() }))

const followerUrl = 'https://remote.test/users/alice'

const request = (id: string) =>
  new NextRequest(
    `https://llun.test/api/v1/follow_requests/${encodeURIComponent(id)}/reject`,
    { method: 'POST' }
  )

describe('POST /api/v1/follow_requests/:id/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
      id: 'follow-1',
      status: 'Requested',
      actorId: followerUrl,
      targetActorId: mockCurrentActor.id
    })
    mockDatabase.getActorFromId.mockResolvedValue({
      id: followerUrl,
      domain: 'remote.test',
      inboxUrl: 'https://remote.test/users/alice/inbox'
    })
  })

  it('returns the getRelationship result, not a hardcoded literal', async () => {
    const relationship = {
      id: urlToId(followerUrl),
      following: false,
      requested: false,
      languages: null
    }
    getRelationship.mockResolvedValue(relationship)
    const id = urlToId(followerUrl)

    const response = await POST(request(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    // Resolved via idToUrl and handed to getRelationship (not the old all-false
    // literal); the response is exactly what getRelationship returns.
    expect(getRelationship).toHaveBeenCalledWith(
      expect.objectContaining({
        currentActor: mockCurrentActor,
        targetActorId: followerUrl
      })
    )
    expect(await response.json()).toEqual(relationship)
  })

  it('accepts a raw actor URL id (first-party UI back-compat)', async () => {
    getRelationship.mockResolvedValue({ id: urlToId(followerUrl) })
    await POST(request(followerUrl), {
      params: Promise.resolve({ id: followerUrl })
    })
    // A raw https:// actor URL is passed through unchanged (not run through
    // idToUrl), matching the authorize route's back-compat behavior.
    expect(mockDatabase.getAcceptedOrRequestedFollow).toHaveBeenCalledWith({
      actorId: followerUrl,
      targetActorId: mockCurrentActor.id
    })
  })

  it('passes a raw http:// actor URL through unchanged (not mangled by idToUrl)', async () => {
    const httpUrl = 'http://local.test/users/alice'
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
      id: 'follow-1',
      status: 'Requested',
      actorId: httpUrl,
      targetActorId: mockCurrentActor.id
    })
    getRelationship.mockResolvedValue({ id: urlToId(httpUrl) })
    await POST(request(httpUrl), {
      params: Promise.resolve({ id: httpUrl })
    })
    // idToUrl would split the scheme colon and mangle an http:// URL, so the
    // route must pass it through unchanged like it does an https:// URL.
    expect(mockDatabase.getAcceptedOrRequestedFollow).toHaveBeenCalledWith({
      actorId: httpUrl,
      targetActorId: mockCurrentActor.id
    })
  })

  it('returns 404 when there is no pending request', async () => {
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    const id = urlToId(followerUrl)
    const response = await POST(request(id), {
      params: Promise.resolve({ id })
    })
    expect(response.status).toBe(404)
    expect(getRelationship).not.toHaveBeenCalled()
  })
})

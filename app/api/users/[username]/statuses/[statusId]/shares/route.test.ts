import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { generatePublicId } from '@/lib/utils/publicId'

import { GET } from './route'

const mockDatabase = {
  getActorStatusFromPathSegment: vi.fn(),
  getStatusReblogsCount: vi.fn()
}
const mockActor: Actor = {
  id: 'https://example.com/users/test',
  username: 'test',
  domain: 'example.com',
  name: 'Test Actor',
  summary: '',
  followersUrl: 'https://example.com/users/test/followers',
  inboxUrl: 'https://example.com/users/test/inbox',
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1,
  publicKey: 'public-key'
}

vi.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
  OnlyLocalUserGuard:
    (handle: (...params: unknown[]) => Promise<Response> | Response) =>
    (req: NextRequest, query: unknown) =>
      handle(mockDatabase, mockActor, req, query)
}))

describe('GET /api/users/[username]/statuses/[statusId]/shares', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
      id: 'https://example.com/users/test/statuses/123',
      url: 'https://example.com/users/test/statuses/123',
      type: StatusType.enum.Note,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    mockDatabase.getStatusReblogsCount.mockResolvedValue(3)
  })

  it('returns the computed ActivityPub shares count', async () => {
    const response = await GET(
      new NextRequest(
        'https://example.com/api/users/test/statuses/123/shares',
        {
          headers: {
            accept:
              'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
          }
        }
      ),
      { params: Promise.resolve({ username: 'test', statusId: '123' }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getActorStatusFromPathSegment).toHaveBeenCalledWith({
      actorId: mockActor.id,
      pathSegment: '123',
      withReplies: false
    })
    expect(mockDatabase.getStatusReblogsCount).toHaveBeenCalledWith({
      statusId: 'https://example.com/users/test/statuses/123'
    })

    const data = await response.json()
    expect(data).toEqual({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://example.com/users/test/statuses/123/shares',
      type: 'Collection',
      totalItems: 3,
      items: []
    })
  })

  describe('publicId path segment', () => {
    // The route hands the raw path segment to the database, which resolves it
    // as either a status URI tail or a publicId and scopes it to this actor.
    const legacyUri = 'https://example.com/users/test/statuses/legacy-tail'

    const requestShares = (publicId: string) =>
      GET(
        new NextRequest(
          `https://example.com/api/users/test/statuses/${publicId}/shares`,
          {
            headers: {
              accept:
                'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
            }
          }
        ),
        { params: Promise.resolve({ username: 'test', statusId: publicId }) }
      )

    it('counts shares on the status the database resolved from a publicId segment', async () => {
      const publicId = generatePublicId()
      mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
        id: legacyUri,
        url: legacyUri,
        actorId: mockActor.id,
        type: StatusType.enum.Note,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await requestShares(publicId)

      expect(response.status).toBe(200)
      expect(mockDatabase.getActorStatusFromPathSegment).toHaveBeenCalledWith({
        actorId: mockActor.id,
        pathSegment: publicId,
        withReplies: false
      })
      expect(mockDatabase.getStatusReblogsCount).toHaveBeenCalledWith({
        statusId: legacyUri
      })

      const data = await response.json()
      expect(data.id).toBe(`${legacyUri}/shares`)
    })

    it('returns not found when the database resolves the segment to nothing', async () => {
      mockDatabase.getActorStatusFromPathSegment.mockResolvedValue(null)

      const response = await requestShares(generatePublicId())

      expect(response.status).toBe(404)
      expect(mockDatabase.getStatusReblogsCount).not.toHaveBeenCalled()
    })

    it('returns not found for a non-public status resolved from a publicId segment', async () => {
      mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
        id: legacyUri,
        url: legacyUri,
        actorId: mockActor.id,
        type: StatusType.enum.Note,
        to: ['https://example.com/users/test/followers'],
        cc: []
      })

      const response = await requestShares(generatePublicId())

      expect(response.status).toBe(404)
      expect(mockDatabase.getStatusReblogsCount).not.toHaveBeenCalled()
    })
  })
})

import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { generatePublicId } from '@/lib/utils/publicId'

import { GET } from './route'

const mockDatabase = {
  getActorStatusFromPathSegment: vi.fn(),
  getLikeCount: vi.fn(),
  getFavouritedBy: vi.fn()
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

describe('GET /api/users/[username]/statuses/[statusId]/likes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
      id: 'https://example.com/users/test/statuses/123',
      url: 'https://example.com/users/test/statuses/123',
      type: StatusType.enum.Note,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    mockDatabase.getLikeCount.mockResolvedValue(7)
  })

  it('returns only the likes count for the ActivityPub Collection', async () => {
    const response = await GET(
      new NextRequest('https://example.com/api/users/test/statuses/123/likes', {
        headers: {
          accept:
            'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
        }
      }),
      { params: Promise.resolve({ username: 'test', statusId: '123' }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getActorStatusFromPathSegment).toHaveBeenCalledWith({
      actorId: mockActor.id,
      pathSegment: '123',
      withReplies: false
    })
    expect(mockDatabase.getLikeCount).toHaveBeenCalledWith({
      statusId: 'https://example.com/users/test/statuses/123'
    })
    expect(mockDatabase.getFavouritedBy).not.toHaveBeenCalled()

    const data = await response.json()
    expect(data).toEqual({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://example.com/users/test/statuses/123/likes',
      type: 'Collection',
      totalItems: 7
    })
  })

  describe('publicId path segment', () => {
    // The route hands the raw path segment to the database, which resolves it
    // as either a status URI tail or a publicId and scopes it to this actor.
    const legacyUri = 'https://example.com/users/test/statuses/legacy-tail'

    const requestLikes = (publicId: string) =>
      GET(
        new NextRequest(
          `https://example.com/api/users/test/statuses/${publicId}/likes`,
          {
            headers: {
              accept:
                'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
            }
          }
        ),
        { params: Promise.resolve({ username: 'test', statusId: publicId }) }
      )

    it('counts likes on the status the database resolved from a publicId segment', async () => {
      const publicId = generatePublicId()
      mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
        id: legacyUri,
        url: legacyUri,
        actorId: mockActor.id,
        type: StatusType.enum.Note,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await requestLikes(publicId)

      expect(response.status).toBe(200)
      expect(mockDatabase.getActorStatusFromPathSegment).toHaveBeenCalledWith({
        actorId: mockActor.id,
        pathSegment: publicId,
        withReplies: false
      })
      expect(mockDatabase.getLikeCount).toHaveBeenCalledWith({
        statusId: legacyUri
      })

      const data = await response.json()
      expect(data.id).toBe(`${legacyUri}/likes`)
    })

    it('returns not found when the database resolves the segment to nothing', async () => {
      mockDatabase.getActorStatusFromPathSegment.mockResolvedValue(null)

      const response = await requestLikes(generatePublicId())

      expect(response.status).toBe(404)
      expect(mockDatabase.getLikeCount).not.toHaveBeenCalled()
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

      const response = await requestLikes(generatePublicId())

      expect(response.status).toBe(404)
      expect(mockDatabase.getLikeCount).not.toHaveBeenCalled()
    })
  })
})

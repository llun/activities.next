import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { generatePublicId } from '@/lib/utils/publicId'

import { GET } from './route'

const mockDatabase = {
  getStatus: vi.fn(),
  getStatusIdByPublicId: vi.fn(),
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
    mockDatabase.getStatus.mockResolvedValue({
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

  describe('publicId fallback for backfilled statuses', () => {
    const legacyUri = 'https://example.com/users/test/statuses/legacy-tail'

    it('resolves a backfilled status whose URI tail differs from its publicId', async () => {
      const publicId = generatePublicId()
      mockDatabase.getStatus.mockImplementation(
        async ({ statusId }: { statusId: string }) =>
          statusId === legacyUri
            ? {
                id: legacyUri,
                url: legacyUri,
                actorId: mockActor.id,
                type: StatusType.enum.Note,
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: []
              }
            : null
      )
      mockDatabase.getStatusIdByPublicId.mockResolvedValue(legacyUri)

      const response = await GET(
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

      expect(response.status).toBe(200)
      expect(mockDatabase.getStatusIdByPublicId).toHaveBeenCalledWith({
        publicId
      })
      expect(mockDatabase.getLikeCount).toHaveBeenCalledWith({
        statusId: legacyUri
      })

      const data = await response.json()
      expect(data.id).toBe(`${legacyUri}/likes`)
    })

    it('returns not found when the publicId belongs to a different actor', async () => {
      const publicId = generatePublicId()
      const otherActorUri =
        'https://example.com/users/other/statuses/legacy-tail'
      mockDatabase.getStatus.mockImplementation(
        async ({ statusId }: { statusId: string }) =>
          statusId === otherActorUri
            ? {
                id: otherActorUri,
                url: otherActorUri,
                actorId: 'https://example.com/users/other',
                type: StatusType.enum.Note,
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: []
              }
            : null
      )
      mockDatabase.getStatusIdByPublicId.mockResolvedValue(otherActorUri)

      const response = await GET(
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

      expect(response.status).toBe(404)
      expect(mockDatabase.getLikeCount).not.toHaveBeenCalled()
    })

    it('returns not found for a non-public status resolved via publicId fallback', async () => {
      const publicId = generatePublicId()
      mockDatabase.getStatus.mockImplementation(
        async ({ statusId }: { statusId: string }) =>
          statusId === legacyUri
            ? {
                id: legacyUri,
                url: legacyUri,
                actorId: mockActor.id,
                type: StatusType.enum.Note,
                to: ['https://example.com/users/test/followers'],
                cc: []
              }
            : null
      )
      mockDatabase.getStatusIdByPublicId.mockResolvedValue(legacyUri)

      const response = await GET(
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

      expect(response.status).toBe(404)
      expect(mockDatabase.getLikeCount).not.toHaveBeenCalled()
    })
  })
})

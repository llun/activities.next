import { NextRequest } from 'next/server'

import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetStatusesByIds = vi.fn()
const mockGetAcceptedFollowTargetActorIds = vi.fn()
const mockDatabase = {
  getStatusesByIds: mockGetStatusesByIds,
  getAcceptedFollowTargetActorIds: mockGetAcceptedFollowTargetActorIds
}
let mockCurrentActor: { id: string } | null = {
  id: 'https://local.example/users/me'
}
const mockInstanceActor = {
  id: 'https://local.example/users/__instance__'
}
const mockLoggerWarn = vi.fn()

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (_scopes: unknown, handle: CallableFunction) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
      if (!mockCurrentActor) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401
        })
      }
      return handle(req, {
        currentActor: mockCurrentActor,
        database: mockDatabase,
        params: context.params
      })
    }
}))

vi.mock('@/lib/activities/getActorPerson')
vi.mock('@/lib/activities/getActorPosts')
vi.mock('@/lib/services/federation/domainPolicy')
vi.mock('@/lib/services/federation/getFederationSigningActor')
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args)
  }
}))

const actorId = 'https://remote.example/users/actor'
const pageUrl = 'https://remote.example/users/actor/outbox?page=true&max_id=1'

const createRequest = (query = '') =>
  new NextRequest(
    `https://local.example/api/v1/accounts/${urlToId(actorId)}/remote-statuses${query}`
  )

describe('GET /api/v1/accounts/[id]/remote-statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentActor = {
      id: 'https://local.example/users/me'
    }
    mockGetStatusesByIds.mockResolvedValue([])
    mockGetAcceptedFollowTargetActorIds.mockResolvedValue([])
    ;(canFederateWithDomain as jest.Mock).mockResolvedValue(true)
    ;(getFederationSigningActorSafe as jest.Mock).mockResolvedValue(
      mockInstanceActor
    )
    ;(getActorPerson as jest.Mock).mockResolvedValue({
      id: actorId,
      type: 'Person',
      preferredUsername: 'actor',
      outbox: `${actorId}/outbox`
    })
    ;(getActorPosts as jest.Mock).mockResolvedValue({
      statuses: [
        {
          id: `${actorId}/statuses/older`,
          actorId,
          actor: null,
          to: [],
          cc: [],
          edits: [],
          isLocalActor: false,
          createdAt: 1,
          updatedAt: 1,
          type: StatusType.enum.Note,
          url: `${actorId}/statuses/older`,
          text: 'Older status',
          summary: null,
          reply: '',
          replies: [],
          actorAnnounceStatusId: null,
          isActorLiked: false,
          isActorBookmarked: false,
          totalLikes: 0,
          totalShares: 0,
          attachments: [],
          tags: []
        }
      ],
      statusesCount: 30,
      nextPageUrl: null,
      prevPageUrl: `${actorId}/outbox?page=true`
    })
  })

  it('returns remote actor statuses for a requested outbox page', async () => {
    const response = await GET(
      createRequest(`?page_url=${encodeURIComponent(pageUrl)}`),
      {
        params: Promise.resolve({ id: urlToId(actorId) })
      }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      statuses: [{ id: `${actorId}/statuses/older` }],
      statusesCount: 30,
      nextPageUrl: null,
      prevPageUrl: `${actorId}/outbox?page=true`
    })
    // Federation fetches are signed by the headless instance actor, not the
    // viewer — secure-mode and multi-domain remotes need a publicly resolvable
    // signer. mockInstanceActor !== mockCurrentActor, so this fails if the route
    // regresses to signing as the viewer.
    expect(getActorPerson).toHaveBeenCalledWith({
      actorId,
      signingActor: mockInstanceActor
    })
    expect(getActorPosts).toHaveBeenCalledWith({
      database: mockDatabase,
      person: expect.objectContaining({ id: actorId }),
      signingActor: mockInstanceActor,
      pageUrl
    })
  })

  it('issues an unsigned fetch when no signing actor can be resolved', async () => {
    // getFederationSigningActorSafe owns the warn-and-degrade behavior; the
    // route only needs to tolerate the undefined signer it returns.
    ;(getFederationSigningActorSafe as jest.Mock).mockResolvedValue(undefined)

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: urlToId(actorId) })
    })

    expect(response.status).toBe(200)
    // `toHaveBeenCalledWith` treats an omitted key and an explicit `undefined`
    // as equal, so assert the signer directly to prove the fetch is unsigned.
    expect((getActorPerson as jest.Mock).mock.calls[0][0].signingActor).toBe(
      undefined
    )
    expect((getActorPosts as jest.Mock).mock.calls[0][0].signingActor).toBe(
      undefined
    )
  })

  it('returns 404 for actors on blocked federation domains without fetching', async () => {
    ;(canFederateWithDomain as jest.Mock).mockResolvedValue(false)

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: urlToId(actorId) })
    })

    expect(response.status).toBe(404)
    expect(getActorPerson).not.toHaveBeenCalled()
    expect(getActorPosts).not.toHaveBeenCalled()
  })

  it('returns bad request for invalid page urls', async () => {
    const response = await GET(createRequest('?page_url=not-a-url'), {
      params: Promise.resolve({ id: urlToId(actorId) })
    })

    expect(response.status).toBe(400)
  })

  it('returns bad request for page urls outside the actor outbox', async () => {
    const response = await GET(
      createRequest(
        `?page_url=${encodeURIComponent(
          'https://attacker.example/users/actor/outbox?page=true'
        )}`
      ),
      {
        params: Promise.resolve({ id: urlToId(actorId) })
      }
    )

    expect(response.status).toBe(400)
    expect(getActorPosts).not.toHaveBeenCalled()
  })

  describe('viewer state overlay', () => {
    it('a stored, liked status comes back with isActorLiked true and keeps its live text and attachments', async () => {
      const liveStatusId = `${actorId}/statuses/stored-liked`
      const liveAttachment = {
        id: 'https://remote.example/photo.jpg',
        actorId,
        statusId: liveStatusId,
        type: 'Document' as const,
        mediaType: 'image/jpeg',
        url: 'https://remote.example/photo.jpg',
        name: 'Live photo description',
        createdAt: 100,
        updatedAt: 100
      }
      const liveNote: Status = {
        id: liveStatusId,
        actorId,
        actor: null,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: false,
        createdAt: 100,
        updatedAt: 100,
        type: StatusType.enum.Note,
        url: liveStatusId,
        text: 'Live status content',
        summary: 'Live summary',
        reply: '',
        replies: [],
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        attachments: [liveAttachment],
        tags: []
      }
      ;(getActorPosts as jest.Mock).mockResolvedValueOnce({
        statuses: [liveNote],
        statusesCount: 1,
        nextPageUrl: null,
        prevPageUrl: null
      })

      mockGetStatusesByIds.mockResolvedValueOnce([
        {
          id: liveStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          type: StatusType.enum.Note,
          isActorLiked: true,
          isActorBookmarked: false,
          actorAnnounceStatusId: null,
          totalLikes: 1,
          text: 'Stale stored text that must not overwrite live',
          summary: 'Stale summary',
          attachments: []
        }
      ])

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: urlToId(actorId) })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(mockGetStatusesByIds).toHaveBeenCalledWith({
        statusIds: [liveStatusId],
        currentActorId: mockCurrentActor!.id,
        withReplies: false
      })
      expect(data.statuses).toHaveLength(1)
      const item = data.statuses[0]
      expect(item.id).toBe(liveStatusId)
      expect(item.isActorLiked).toBe(true)
      expect(item.totalLikes).toBe(1)
      expect(item.text).toBe('Live status content')
      expect(item.summary).toBe('Live summary')
      expect(item.attachments).toEqual([liveAttachment])
    })

    it('a stored, bookmarked and reposted one carries isActorBookmarked and actorAnnounceStatusId', async () => {
      const liveStatusId = `${actorId}/statuses/stored-reposted`
      const liveNote: Status = {
        id: liveStatusId,
        actorId,
        actor: null,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: false,
        createdAt: 100,
        updatedAt: 100,
        type: StatusType.enum.Note,
        url: liveStatusId,
        text: 'Another live status',
        summary: null,
        reply: '',
        replies: [],
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 2,
        attachments: [],
        tags: []
      }
      ;(getActorPosts as jest.Mock).mockResolvedValueOnce({
        statuses: [liveNote],
        statusesCount: 1,
        nextPageUrl: null,
        prevPageUrl: null
      })

      const announceId = 'https://local.example/statuses/announce-777'
      mockGetStatusesByIds.mockResolvedValueOnce([
        {
          id: liveStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          type: StatusType.enum.Note,
          isActorLiked: false,
          isActorBookmarked: true,
          actorAnnounceStatusId: announceId,
          totalLikes: 0
        }
      ])

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: urlToId(actorId) })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.statuses[0].isActorBookmarked).toBe(true)
      expect(data.statuses[0].actorAnnounceStatusId).toBe(announceId)
      expect(data.statuses[0].totalShares).toBe(2)
    })

    it('an unstored one is unchanged', async () => {
      const unstoredStatusId = `${actorId}/statuses/unstored-1`
      const liveNote: Status = {
        id: unstoredStatusId,
        actorId,
        actor: null,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: false,
        createdAt: 100,
        updatedAt: 100,
        type: StatusType.enum.Note,
        url: unstoredStatusId,
        text: 'Unstored post',
        summary: null,
        reply: '',
        replies: [],
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        attachments: [],
        tags: []
      }
      ;(getActorPosts as jest.Mock).mockResolvedValueOnce({
        statuses: [liveNote],
        statusesCount: 1,
        nextPageUrl: null,
        prevPageUrl: null
      })

      mockGetStatusesByIds.mockResolvedValueOnce([])

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: urlToId(actorId) })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.statuses[0].id).toBe(unstoredStatusId)
      expect(data.statuses[0].isActorLiked).toBe(false)
      expect(data.statuses[0].isActorBookmarked).toBe(false)
      expect(data.statuses[0].actorAnnounceStatusId).toBeNull()
      expect(data.statuses[0].totalLikes).toBe(0)
    })

    it('a live Announce gets the overlay on originalStatus', async () => {
      const originalStatusId = 'https://other.example/users/bob/statuses/1'
      const announceStatusId = `${actorId}/statuses/announce-live-1`
      const originalLiveNote = {
        id: originalStatusId,
        actorId: 'https://other.example/users/bob',
        actor: null,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: false,
        createdAt: 50,
        updatedAt: 50,
        type: StatusType.enum.Note,
        url: originalStatusId,
        text: 'Original bob status',
        summary: null,
        reply: '',
        replies: [],
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        attachments: [],
        tags: []
      }
      const liveAnnounce: Status = {
        id: announceStatusId,
        actorId,
        actor: null,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: false,
        createdAt: 100,
        updatedAt: 100,
        type: StatusType.enum.Announce,
        originalStatus: originalLiveNote as unknown as Status
      }
      ;(getActorPosts as jest.Mock).mockResolvedValueOnce({
        statuses: [liveAnnounce],
        statusesCount: 1,
        nextPageUrl: null,
        prevPageUrl: null
      })

      mockGetStatusesByIds.mockResolvedValueOnce([
        {
          id: originalStatusId,
          actorId: 'https://other.example/users/bob',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          type: StatusType.enum.Note,
          isActorLiked: true,
          isActorBookmarked: true,
          actorAnnounceStatusId: 'https://local.example/statuses/announce-bob',
          totalLikes: 3
        }
      ])

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: urlToId(actorId) })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(mockGetStatusesByIds).toHaveBeenCalledWith({
        statusIds: [originalStatusId],
        currentActorId: mockCurrentActor!.id,
        withReplies: false
      })
      expect(data.statuses[0].id).toBe(announceStatusId)
      expect(data.statuses[0].type).toBe(StatusType.enum.Announce)
      expect(data.statuses[0].originalStatus.id).toBe(originalStatusId)
      expect(data.statuses[0].originalStatus.isActorLiked).toBe(true)
      expect(data.statuses[0].originalStatus.isActorBookmarked).toBe(true)
      expect(data.statuses[0].originalStatus.actorAnnounceStatusId).toBe(
        'https://local.example/statuses/announce-bob'
      )
      expect(data.statuses[0].originalStatus.totalLikes).toBe(3)
    })

    it('a live note matching an unreadable stored status comes back with no overlay', async () => {
      const liveStatusId = `${actorId}/statuses/unreadable-stored`
      const liveNote: Status = {
        id: liveStatusId,
        actorId,
        actor: null,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: false,
        createdAt: 100,
        updatedAt: 100,
        type: StatusType.enum.Note,
        url: liveStatusId,
        text: 'Live note text',
        summary: null,
        reply: '',
        replies: [],
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        attachments: [],
        tags: []
      }
      ;(getActorPosts as jest.Mock).mockResolvedValueOnce({
        statuses: [liveNote],
        statusesCount: 1,
        nextPageUrl: null,
        prevPageUrl: null
      })

      // Stored status has same id and actorId, but is private/unreadable for the viewer
      mockGetStatusesByIds.mockResolvedValueOnce([
        {
          id: liveStatusId,
          actorId,
          to: ['https://remote.example/users/secret'],
          cc: [],
          type: StatusType.enum.Note,
          isActorLiked: true,
          isActorBookmarked: true,
          actorAnnounceStatusId:
            'https://local.example/statuses/announce-unreadable',
          totalLikes: 42,
          reactions: [
            {
              name: '❤️',
              count: 1,
              me: true,
              url: null,
              static_url: null
            }
          ]
        }
      ])

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: urlToId(actorId) })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.statuses[0].id).toBe(liveStatusId)
      expect(data.statuses[0].isActorLiked).toBe(false)
      expect(data.statuses[0].isActorBookmarked).toBe(false)
      expect(data.statuses[0].actorAnnounceStatusId).toBeNull()
      expect(data.statuses[0].totalLikes).toBe(0)
      expect(data.statuses[0].reactions).toBeUndefined()
    })

    it('a live note matching a stored public status with a different actorId comes back unchanged', async () => {
      const hijackedStatusId = `${actorId}/statuses/hijacked-target`
      const liveNote: Status = {
        id: hijackedStatusId,
        actorId,
        actor: null,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: false,
        createdAt: 100,
        updatedAt: 100,
        type: StatusType.enum.Note,
        url: hijackedStatusId,
        text: 'Live note text claiming another status id',
        summary: null,
        reply: '',
        replies: [],
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        attachments: [],
        tags: []
      }
      ;(getActorPosts as jest.Mock).mockResolvedValueOnce({
        statuses: [liveNote],
        statusesCount: 1,
        nextPageUrl: null,
        prevPageUrl: null
      })

      // Stored status is public and liked, but authored by a different actor
      mockGetStatusesByIds.mockResolvedValueOnce([
        {
          id: hijackedStatusId,
          actorId: 'https://victim.example/users/victim',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          type: StatusType.enum.Note,
          isActorLiked: true,
          isActorBookmarked: true,
          actorAnnounceStatusId:
            'https://local.example/statuses/announce-victim',
          totalLikes: 99,
          reactions: [
            {
              name: '🔥',
              count: 5,
              me: true,
              url: null,
              static_url: null
            }
          ]
        }
      ])

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: urlToId(actorId) })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.statuses[0].id).toBe(hijackedStatusId)
      expect(data.statuses[0].isActorLiked).toBe(false)
      expect(data.statuses[0].isActorBookmarked).toBe(false)
      expect(data.statuses[0].actorAnnounceStatusId).toBeNull()
      expect(data.statuses[0].totalLikes).toBe(0)
      expect(data.statuses[0].reactions).toBeUndefined()
    })

    it('rejects signed-out requests with 401 and looks up nothing', async () => {
      mockCurrentActor = null

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: urlToId(actorId) })
      })

      expect(response.status).toBe(401)
      expect(mockGetStatusesByIds).not.toHaveBeenCalled()
      expect(getActorPosts).not.toHaveBeenCalled()
    })
  })
})

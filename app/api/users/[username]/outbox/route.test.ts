import { NextRequest } from 'next/server'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { type Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const mockDatabase = {
  getActorStatusesCount: vi.fn(),
  getActorStatuses: vi.fn()
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
  statusCount: 3,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1,
  publicKey: 'public-key'
}

const createPublicNoteStatus = (id: string, createdAt = Date.UTC(2026, 0, 1)) =>
  ({
    id,
    actorId: mockActor.id,
    actor: null,
    type: StatusType.enum.Note,
    url: id,
    text: '<p>Hello ActivityPub</p>',
    summary: null,
    reply: '',
    replies: [],
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [`${mockActor.id}/followers`],
    edits: [],
    isLocalActor: true,
    actorAnnounceStatusId: null,
    isActorLiked: false,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: [],
    createdAt,
    updatedAt: createdAt
  }) as const

const createUnreadableAnnounceStatus = (
  id: string,
  createdAt = Date.UTC(2026, 0, 1)
) =>
  ({
    id,
    actorId: mockActor.id,
    actor: null,
    type: StatusType.enum.Announce,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],
    isLocalActor: true,
    originalStatus: {
      ...createPublicNoteStatus(`${id}/original`, createdAt - 1),
      to: [`${mockActor.id}/followers`],
      cc: []
    },
    createdAt,
    updatedAt: createdAt
  }) as const

vi.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
  OnlyLocalUserGuard:
    (
      handle: (...params: unknown[]) => Promise<Response> | Response,
      options?: { allowFederationSigningActor?: boolean }
    ) =>
    (req: NextRequest, query: unknown) => {
      if (!options?.allowFederationSigningActor) {
        return new Response(null, { status: 404 })
      }

      return handle(mockDatabase, mockActor, req, query)
    }
}))

describe('GET /api/users/[username]/outbox', () => {
  beforeEach(() => {
    mockDatabase.getActorStatusesCount.mockClear()
    mockDatabase.getActorStatusesCount.mockResolvedValue(0)
    mockDatabase.getActorStatuses.mockClear()
    mockDatabase.getActorStatuses.mockResolvedValue([])
  })

  it('negotiates collection responses with the shared ActivityPub helper', async () => {
    mockDatabase.getActorStatusesCount.mockResolvedValue(3)

    const response = await GET(
      new NextRequest('https://example.com/api/users/test/outbox', {
        headers: {
          accept:
            'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
        }
      }),
      { params: Promise.resolve({ username: 'test' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
    )

    const data = await response.json()
    expect(data).toMatchObject({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://example.com/users/test/outbox',
      type: 'OrderedCollection',
      totalItems: 3,
      first: 'https://example.com/users/test/outbox?page=true'
    })
    expect(mockDatabase.getActorStatusesCount).toHaveBeenCalledWith({
      actorId: mockActor.id,
      publicOnly: true
    })
    expect(mockDatabase.getActorStatuses).not.toHaveBeenCalled()
  })

  it('serializes outbox Create objects as ActivityPub Note objects', async () => {
    const createdAt = Date.UTC(2026, 0, 1)
    const status = createPublicNoteStatus(
      'https://example.com/users/test/statuses/post-1',
      createdAt
    )
    mockDatabase.getActorStatuses.mockResolvedValue([status])

    const response = await GET(
      new NextRequest('https://example.com/api/users/test/outbox?page=true', {
        headers: {
          accept:
            'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
        }
      }),
      { params: Promise.resolve({ username: 'test' }) }
    )

    const data = await response.json()

    expect(data.orderedItems[0]).toMatchObject({
      id: `${status.id}/activity`,
      type: 'Create',
      actor: mockActor.id,
      object: {
        id: status.id,
        type: 'Note',
        attributedTo: mockActor.id,
        content: '<p>Hello ActivityPub</p>'
      }
    })
    expect(data.orderedItems[0].object).not.toHaveProperty('actorId')
    expect(data.orderedItems[0].object).not.toHaveProperty('text')
  })

  it('omits followers-only statuses from public ActivityPub outbox pages', async () => {
    const createdAt = Date.UTC(2026, 0, 2)
    const publicStatus = createPublicNoteStatus(
      'https://example.com/users/test/statuses/public-post',
      createdAt
    )
    const privateStatus = {
      ...publicStatus,
      id: 'https://example.com/users/test/statuses/private-post',
      url: 'https://example.com/@test/private-post',
      text: '<p>Private post</p>',
      to: [`${mockActor.id}/followers`],
      cc: []
    }
    mockDatabase.getActorStatuses.mockResolvedValue([
      publicStatus,
      privateStatus
    ])

    const response = await GET(
      new NextRequest('https://example.com/api/users/test/outbox?page=true', {
        headers: {
          accept:
            'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
        }
      }),
      { params: Promise.resolve({ username: 'test' }) }
    )

    const data = await response.json()

    expect(mockDatabase.getActorStatuses).toHaveBeenCalledWith({
      actorId: mockActor.id,
      publicOnly: true,
      limit: PER_PAGE_LIMIT
    })
    expect(data.orderedItems).toHaveLength(1)
    expect(data.orderedItems[0].object.id).toBe(publicStatus.id)
  })

  it('backfills outbox pages after filtering unreadable announces from a full batch', async () => {
    const createdAt = Date.UTC(2026, 0, 3)
    const publicStatus = createPublicNoteStatus(
      'https://example.com/users/test/statuses/public-post-backfill-first',
      createdAt
    )
    const hiddenBatch = Array.from({ length: PER_PAGE_LIMIT - 1 }, (_, index) =>
      createUnreadableAnnounceStatus(
        `https://example.com/users/test/statuses/hidden-announce-${index}`,
        createdAt - index - 1
      )
    )
    const firstBatch = [publicStatus, ...hiddenBatch]
    const backfilledStatus = createPublicNoteStatus(
      'https://example.com/users/test/statuses/public-post-backfill-second',
      createdAt - PER_PAGE_LIMIT - 1
    )
    mockDatabase.getActorStatuses
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([backfilledStatus])

    const response = await GET(
      new NextRequest('https://example.com/api/users/test/outbox?page=true', {
        headers: {
          accept:
            'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
        }
      }),
      { params: Promise.resolve({ username: 'test' }) }
    )

    const data = await response.json()
    const itemIds = data.orderedItems.map(
      (item: { object: { id: string } }) => item.object.id
    )

    expect(mockDatabase.getActorStatuses).toHaveBeenNthCalledWith(1, {
      actorId: mockActor.id,
      publicOnly: true,
      limit: PER_PAGE_LIMIT
    })
    expect(mockDatabase.getActorStatuses).toHaveBeenNthCalledWith(2, {
      actorId: mockActor.id,
      publicOnly: true,
      limit: PER_PAGE_LIMIT,
      maxStatusId: firstBatch[firstBatch.length - 1].id
    })
    expect(itemIds).toEqual([publicStatus.id, backfilledStatus.id])
  })

  it('derives collection totalItems from a SQL count', async () => {
    mockDatabase.getActorStatusesCount.mockResolvedValue(1)

    const response = await GET(
      new NextRequest('https://example.com/api/users/test/outbox', {
        headers: {
          accept:
            'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
        }
      }),
      { params: Promise.resolve({ username: 'test' }) }
    )

    const data = await response.json()

    expect(mockDatabase.getActorStatusesCount).toHaveBeenCalledWith({
      actorId: mockActor.id,
      publicOnly: true
    })
    expect(mockDatabase.getActorStatuses).not.toHaveBeenCalled()
    expect(data.totalItems).toBe(1)
  })
})

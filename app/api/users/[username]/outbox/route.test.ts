import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const mockDatabase = {
  getActorStatuses: jest.fn()
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

jest.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
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
    mockDatabase.getActorStatuses.mockClear()
    mockDatabase.getActorStatuses.mockResolvedValue([])
  })

  it('negotiates collection responses with the shared ActivityPub helper', async () => {
    mockDatabase.getActorStatuses.mockResolvedValue([
      createPublicNoteStatus('https://example.com/users/test/statuses/post-1'),
      createPublicNoteStatus('https://example.com/users/test/statuses/post-2'),
      createPublicNoteStatus('https://example.com/users/test/statuses/post-3')
    ])

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
      publicOnly: true
    })
    expect(data.orderedItems).toHaveLength(1)
    expect(data.orderedItems[0].object.id).toBe(publicStatus.id)
  })

  it('derives collection totalItems from publicly readable statuses', async () => {
    const publicStatus = createPublicNoteStatus(
      'https://example.com/users/test/statuses/public-post',
      Date.UTC(2026, 0, 3)
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
      new NextRequest('https://example.com/api/users/test/outbox', {
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
      limit: mockActor.statusCount,
      publicOnly: true
    })
    expect(data.totalItems).toBe(1)
  })
})

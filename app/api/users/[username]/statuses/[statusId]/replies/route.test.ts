import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const mockDatabase = {
  getStatus: vi.fn(),
  getStatusReplies: vi.fn(),
  getStatusRepliesCount: vi.fn()
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

describe('GET /api/users/[username]/statuses/[statusId]/replies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getStatus.mockResolvedValue({
      id: 'https://example.com/users/test/statuses/123',
      url: 'https://example.com/users/test/statuses/123',
      type: StatusType.enum.Note,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      actor: { domain: 'example.com' }
    })
    mockDatabase.getStatusReplies.mockResolvedValue([
      {
        id: 'https://example.com/users/other/statuses/reply-1',
        actorId: 'https://example.com/users/other',
        actor: null,
        type: StatusType.enum.Note,
        url: 'https://example.com/users/other/statuses/reply-1',
        text: '<p>reply</p>',
        summary: null,
        reply: 'https://example.com/users/test/statuses/123',
        replies: [],
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        edits: [],
        isLocalActor: false,
        actorAnnounceStatusId: null,
        isActorLiked: false,
        totalLikes: 0,
        totalShares: 0,
        attachments: [],
        tags: [],
        createdAt: Date.UTC(2026, 0, 1),
        updatedAt: Date.UTC(2026, 0, 1)
      }
    ])
    mockDatabase.getStatusRepliesCount.mockResolvedValue(3)
  })

  it('returns public replies as an ActivityPub Collection', async () => {
    const response = await GET(
      new NextRequest(
        'https://example.com/api/users/test/statuses/123/replies',
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
    expect(mockDatabase.getStatusReplies).toHaveBeenCalledWith({
      statusId: 'https://example.com/users/test/statuses/123',
      url: 'https://example.com/users/test/statuses/123',
      publicOnly: true,
      limit: 100
    })
    expect(mockDatabase.getStatusRepliesCount).toHaveBeenCalledWith({
      statusId: 'https://example.com/users/test/statuses/123',
      url: 'https://example.com/users/test/statuses/123',
      publicOnly: true
    })

    const data = await response.json()
    expect(data).toMatchObject({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://example.com/users/test/statuses/123/replies',
      type: 'Collection',
      totalItems: 3,
      items: [
        {
          id: 'https://example.com/users/other/statuses/reply-1',
          type: 'Note',
          attributedTo: 'https://example.com/users/other'
        }
      ]
    })
  })
})

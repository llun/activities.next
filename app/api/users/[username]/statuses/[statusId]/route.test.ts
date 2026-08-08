import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { generatePublicId } from '@/lib/utils/publicId'

import { GET } from './route'

const mockDatabase = {
  getStatus: vi.fn(),
  getStatusIdByPublicId: vi.fn(),
  getStatusReplies: vi.fn()
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
const mockToActivityPubObject = vi.fn()

vi.mock('@/lib/services/guards/OnlyLocalUserGuard', async () => ({
  OnlyLocalUserGuard:
    (handle: (...params: unknown[]) => Promise<Response> | Response) =>
    (req: NextRequest, query: unknown) =>
      handle(mockDatabase, mockActor, req, query)
}))

vi.mock('@/lib/types/domain/status', async () => {
  const actual = await vi.importActual('@/lib/types/domain/status')
  return {
    ...actual,
    toActivityPubObject: (...params: unknown[]) =>
      mockToActivityPubObject(...params)
  }
})

const createRequest = (accept: string) =>
  new NextRequest('https://example.com/api/users/test/statuses/123', {
    headers: { accept }
  })

describe('GET /api/users/[username]/statuses/[statusId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getStatus.mockResolvedValue({
      id: 'https://example.com/users/test/statuses/123',
      // A local status stores the web detail page as its url, not its AP URI.
      url: 'https://example.com/@test/123',
      type: 'Note',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      actor: { domain: 'example.com' }
    })
    mockDatabase.getStatusReplies.mockResolvedValue([])
    mockToActivityPubObject.mockReturnValue({
      id: 'https://example.com/users/test/statuses/123',
      type: 'Note',
      attributedTo: 'https://example.com/users/test'
    })
  })

  it('returns generic JSON when that is the negotiated ActivityPub type', async () => {
    const response = await GET(
      createRequest('application/json, text/html;q=0.5'),
      { params: Promise.resolve({ username: 'test', statusId: '123' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(mockDatabase.getStatus).toHaveBeenCalledWith({
      statusId: 'https://example.com/users/test/statuses/123',
      withReplies: false
    })

    const data = await response.json()
    expect(data).toMatchObject({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://example.com/users/test/statuses/123',
      type: 'Note'
    })
  })

  it('redirects to the status page when HTML is preferred', async () => {
    const response = await GET(createRequest('text/html, */*;q=0.8'), {
      params: Promise.resolve({ username: 'test', statusId: '123' })
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://example.com/@test/123'
    )
    expect(response.headers.get('server')).toBe('activities.next')
    expect(response.headers.get('vary')).toBe('Accept')
  })

  it('redirects an announce to its own uri tail because it stores no url', async () => {
    const announceUri = 'https://example.com/users/test/statuses/announce-tail'
    mockDatabase.getStatus.mockResolvedValue({
      id: announceUri,
      url: null,
      type: 'Announce',
      actorId: mockActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      actor: { domain: 'example.com' },
      originalStatus: {
        id: 'https://example.com/users/other/statuses/original',
        url: 'https://example.com/@other/original',
        type: 'Note',
        actorId: 'https://example.com/users/other',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        actor: { domain: 'example.com' }
      }
    })
    mockToActivityPubObject.mockReturnValue({
      id: `${announceUri}/activity`,
      type: 'Announce'
    })

    const response = await GET(createRequest('text/html, */*;q=0.8'), {
      params: Promise.resolve({ username: 'test', statusId: 'announce-tail' })
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://example.com/@test/announce-tail'
    )
  })

  it('returns not found for a non-public ActivityPub object request', async () => {
    mockDatabase.getStatus.mockResolvedValue({
      id: 'https://example.com/users/test/statuses/123',
      url: 'https://example.com/users/test/statuses/123',
      type: 'Note',
      to: ['https://example.com/users/test/followers'],
      cc: [],
      actor: { domain: 'example.com' }
    })

    const response = await GET(createRequest('application/activity+json'), {
      params: Promise.resolve({ username: 'test', statusId: '123' })
    })

    expect(response.status).toBe(404)
    expect(mockDatabase.getStatusReplies).not.toHaveBeenCalled()
    expect(mockToActivityPubObject).not.toHaveBeenCalled()
  })

  it('filters non-public replies from public ActivityPub object responses', async () => {
    const publicReply = {
      id: 'https://example.com/users/other/statuses/public-reply',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    }
    const privateReply = {
      id: 'https://example.com/users/other/statuses/private-reply',
      to: ['https://example.com/users/other/followers'],
      cc: []
    }
    mockDatabase.getStatusReplies.mockResolvedValue([publicReply, privateReply])

    await GET(createRequest('application/activity+json'), {
      params: Promise.resolve({ username: 'test', statusId: '123' })
    })

    expect(mockDatabase.getStatusReplies).toHaveBeenCalledWith({
      statusId: 'https://example.com/users/test/statuses/123',
      url: 'https://example.com/@test/123',
      publicOnly: true,
      limit: 100
    })
    expect(mockToActivityPubObject).toHaveBeenCalledWith(
      expect.objectContaining({
        replies: [publicReply]
      })
    )
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
                type: 'Note',
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: [],
                actor: { domain: 'example.com' }
              }
            : null
      )
      mockDatabase.getStatusIdByPublicId.mockResolvedValue(legacyUri)
      mockToActivityPubObject.mockReturnValue({
        id: legacyUri,
        type: 'Note',
        attributedTo: mockActor.id
      })

      const response = await GET(createRequest('application/activity+json'), {
        params: Promise.resolve({ username: 'test', statusId: publicId })
      })

      expect(response.status).toBe(200)
      expect(mockDatabase.getStatusIdByPublicId).toHaveBeenCalledWith({
        publicId
      })
      expect(mockDatabase.getStatus).toHaveBeenLastCalledWith({
        statusId: legacyUri,
        withReplies: false
      })

      const data = await response.json()
      expect(data.id).toBe(legacyUri)
    })

    it('redirects an HTML request to the resolved status url, not the publicId path', async () => {
      const publicId = generatePublicId()
      const legacyWebUrl = 'https://example.com/@test/legacy-tail'
      mockDatabase.getStatus.mockImplementation(
        async ({ statusId }: { statusId: string }) =>
          statusId === legacyUri
            ? {
                id: legacyUri,
                url: legacyWebUrl,
                actorId: mockActor.id,
                type: 'Note',
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: [],
                actor: { domain: 'example.com' }
              }
            : null
      )
      mockDatabase.getStatusIdByPublicId.mockResolvedValue(legacyUri)
      mockToActivityPubObject.mockReturnValue({
        id: legacyUri,
        type: 'Note',
        attributedTo: mockActor.id
      })

      const response = await GET(createRequest('text/html, */*;q=0.8'), {
        params: Promise.resolve({ username: 'test', statusId: publicId })
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(legacyWebUrl)
      expect(response.headers.get('location')).not.toContain(publicId)
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
                type: 'Note',
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: [],
                actor: { domain: 'example.com' }
              }
            : null
      )
      mockDatabase.getStatusIdByPublicId.mockResolvedValue(otherActorUri)

      const response = await GET(createRequest('application/activity+json'), {
        params: Promise.resolve({ username: 'test', statusId: publicId })
      })

      expect(response.status).toBe(404)
      expect(mockToActivityPubObject).not.toHaveBeenCalled()
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
                type: 'Note',
                to: ['https://example.com/users/test/followers'],
                cc: [],
                actor: { domain: 'example.com' }
              }
            : null
      )
      mockDatabase.getStatusIdByPublicId.mockResolvedValue(legacyUri)

      const response = await GET(createRequest('application/activity+json'), {
        params: Promise.resolve({ username: 'test', statusId: publicId })
      })

      expect(response.status).toBe(404)
      expect(mockToActivityPubObject).not.toHaveBeenCalled()
    })
  })
})

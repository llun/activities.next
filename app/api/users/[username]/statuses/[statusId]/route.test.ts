import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const mockDatabase = {
  getStatus: vi.fn(),
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
      url: 'https://example.com/users/test/statuses/123',
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
      url: 'https://example.com/users/test/statuses/123',
      publicOnly: true,
      limit: 100
    })
    expect(mockToActivityPubObject).toHaveBeenCalledWith(
      expect.objectContaining({
        replies: [publicReply]
      })
    )
  })
})

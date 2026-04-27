import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'

import { GET } from './route'

const mockDatabase = {
  getStatus: jest.fn()
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
const mockToActivityPubObject = jest.fn()

jest.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
  OnlyLocalUserGuard:
    (handle: (...params: unknown[]) => Promise<Response> | Response) =>
    (req: NextRequest, query: unknown) =>
      handle(mockDatabase, mockActor, req, query)
}))

jest.mock('@/lib/types/domain/status', () => ({
  toActivityPubObject: (...params: unknown[]) =>
    mockToActivityPubObject(...params)
}))

const createRequest = (accept: string) =>
  new NextRequest('https://example.com/api/users/test/statuses/123', {
    headers: { accept }
  })

describe('GET /api/users/[username]/statuses/[statusId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase.getStatus.mockResolvedValue({
      id: 'https://example.com/users/test/statuses/123',
      actor: { domain: 'example.com' }
    })
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
      withReplies: true
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
  })
})

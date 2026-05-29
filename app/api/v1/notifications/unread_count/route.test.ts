import { NextRequest } from 'next/server'

import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockDatabase = {
  getNotificationsCount: jest.fn(),
  getNotifications: jest.fn()
}

const mockCurrentActor = {
  id: 'https://llun.test/users/llun'
}

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          currentActor: typeof mockCurrentActor
          params: Promise<{}>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, {
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

describe('GET /api/v1/notifications/unread_count', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the unread count capped at the default limit of 100', async () => {
    mockDatabase.getNotificationsCount.mockResolvedValueOnce(7)

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/unread_count',
      { method: 'GET' }
    )

    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ count: 7 })
    expect(mockDatabase.getNotificationsCount).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        onlyUnread: true,
        limit: 100
      })
    )
  })

  it('returns 422 when limit exceeds the maximum', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/unread_count?limit=1001',
      { method: 'GET' }
    )

    const response = await GET(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(422)
    expect(mockDatabase.getNotificationsCount).not.toHaveBeenCalled()
  })

  it('maps and forwards type filters to the count query', async () => {
    mockDatabase.getNotificationsCount.mockResolvedValueOnce(2)

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/unread_count?types[]=favourite&exclude_types[]=follow',
      { method: 'GET' }
    )

    await GET(request, { params: Promise.resolve({}) })

    expect(mockDatabase.getNotificationsCount).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ['like'],
        excludeTypes: ['follow']
      })
    )
  })

  it('merges bare and bracketed forms of the same array param', async () => {
    mockDatabase.getNotificationsCount.mockResolvedValueOnce(1)

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/unread_count?types=favourite&types[]=reblog',
      { method: 'GET' }
    )

    await GET(request, { params: Promise.resolve({}) })

    expect(mockDatabase.getNotificationsCount).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['like', 'reblog'] })
    )
  })

  it('returns 422 when limit is a float', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/unread_count?limit=1.5',
      { method: 'GET' }
    )

    const response = await GET(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(422)
    expect(mockDatabase.getNotificationsCount).not.toHaveBeenCalled()
  })

  it('caps account_id match count at the requested limit', async () => {
    const aliceId = 'https://other.test/users/alice'
    mockDatabase.getNotifications.mockResolvedValueOnce([
      { id: 'n1', sourceActorId: aliceId },
      { id: 'n2', sourceActorId: aliceId },
      { id: 'n3', sourceActorId: aliceId }
    ])

    const accountId = urlToId(aliceId)
    const request = new NextRequest(
      `https://llun.test/api/v1/notifications/unread_count?account_id=${encodeURIComponent(accountId)}&limit=2`,
      { method: 'GET' }
    )

    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ count: 2 })
  })

  it('counts via post-fetch account_id filtering on sourceActorId', async () => {
    const aliceId = 'https://other.test/users/alice'
    const bobId = 'https://other.test/users/bob'
    mockDatabase.getNotifications.mockResolvedValueOnce([
      { id: 'n1', sourceActorId: aliceId },
      { id: 'n2', sourceActorId: bobId },
      { id: 'n3', sourceActorId: aliceId }
    ])

    const accountId = urlToId(aliceId)
    const request = new NextRequest(
      `https://llun.test/api/v1/notifications/unread_count?account_id=${encodeURIComponent(accountId)}`,
      { method: 'GET' }
    )

    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ count: 2 })
    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        onlyUnread: true,
        limit: 1000
      })
    )
    expect(mockDatabase.getNotificationsCount).not.toHaveBeenCalled()
  })
})

import { NextRequest } from 'next/server'

import { GET } from './route'

const mockDatabase = {
  getNotifications: jest.fn(),
  getActiveFiltersForActor: jest.fn().mockResolvedValue([])
}

const mockCurrentActor = { id: 'https://llun.test/users/llun' }

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: { currentActor: typeof mockCurrentActor; params: Promise<{}> }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, { currentActor: mockCurrentActor, params: context.params })
}))

describe('GET /api/v2/notifications/unread_count', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase.getNotifications.mockResolvedValue([])
  })

  it('returns count of unread groups', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([
      {
        id: 'n1',
        type: 'like',
        sourceActorId: 'https://other.test/users/alice',
        statusId: 'https://other.test/statuses/1',
        groupKey: 'like:https://other.test/statuses/1',
        isRead: false,
        filtered: false,
        createdAt: 2000,
        updatedAt: 2000
      },
      {
        id: 'n2',
        type: 'like',
        sourceActorId: 'https://other.test/users/bob',
        statusId: 'https://other.test/statuses/1',
        groupKey: 'like:https://other.test/statuses/1',
        isRead: false,
        filtered: false,
        createdAt: 1000,
        updatedAt: 1000
      },
      {
        id: 'n3',
        type: 'follow',
        sourceActorId: 'https://other.test/users/carol',
        isRead: false,
        filtered: false,
        createdAt: 3000,
        updatedAt: 3000
      }
    ])

    const request = new NextRequest(
      'https://llun.test/api/v2/notifications/unread_count',
      { method: 'GET' }
    )
    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    // 2 likes collapse into 1 group; 1 follow = 1 group → total 2
    expect(data.count).toBe(2)
    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ onlyUnread: true })
    )
  })

  it('returns 422 for invalid limit', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v2/notifications/unread_count?limit=0',
      { method: 'GET' }
    )
    const response = await GET(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(422)
    expect(mockDatabase.getNotifications).not.toHaveBeenCalled()
  })

  it('filters by account_id', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([
      {
        id: 'n1',
        type: 'like',
        sourceActorId: 'https://other.test/users/alice',
        statusId: 'https://other.test/statuses/1',
        groupKey: 'like:s1',
        isRead: false,
        filtered: false,
        createdAt: 2000,
        updatedAt: 2000
      },
      {
        id: 'n2',
        type: 'like',
        sourceActorId: 'https://other.test/users/bob',
        statusId: 'https://other.test/statuses/2',
        groupKey: 'like:s2',
        isRead: false,
        filtered: false,
        createdAt: 1000,
        updatedAt: 1000
      }
    ])

    const request = new NextRequest(
      'https://llun.test/api/v2/notifications/unread_count?account_id=other.test%3Ausers%3Aalice',
      { method: 'GET' }
    )
    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.count).toBe(1)
  })
})

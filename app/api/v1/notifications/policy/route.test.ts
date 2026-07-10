import { NextRequest } from 'next/server'

import { DEFAULT_NOTIFICATION_POLICY } from '@/lib/types/database/operations'

import { GET, PATCH, PUT } from './route'

const mockDatabase = {
  getNotificationPolicy: vi.fn(),
  updateNotificationPolicy: vi.fn(),
  getNotificationsCount: vi.fn(),
  getNotificationRequestsCount: vi.fn()
}

const mockCurrentActor = { id: 'https://llun.test/users/llun' }

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          currentActor: typeof mockCurrentActor
          database: typeof mockDatabase
          params: Promise<object>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<object> }) =>
      handle(req, {
        currentActor: mockCurrentActor,
        database: mockDatabase,
        params: context.params
      })
}))

const params = { params: Promise.resolve({}) }

describe('/api/v1/notifications/policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getNotificationPolicy.mockResolvedValue({
      ...DEFAULT_NOTIFICATION_POLICY
    })
    mockDatabase.getNotificationsCount.mockResolvedValue(3)
    mockDatabase.getNotificationRequestsCount.mockResolvedValue(1)
  })

  it('serializes the stored policy as v1 filter booleans with the summary', async () => {
    mockDatabase.getNotificationPolicy.mockResolvedValue({
      ...DEFAULT_NOTIFICATION_POLICY,
      for_not_following: 'filter',
      for_private_mentions: 'drop'
    })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/notifications/policy'),
      params
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      filter_not_following: true,
      filter_not_followers: false,
      filter_new_accounts: false,
      filter_private_mentions: true,
      summary: { pending_requests_count: 1, pending_notifications_count: 3 }
    })
  })

  it.each([
    { method: 'PUT', handler: PUT },
    { method: 'PATCH', handler: PATCH }
  ])(
    'maps legacy booleans onto the stored policy via $method',
    async ({ method, handler }) => {
      mockDatabase.getNotificationPolicy.mockResolvedValue({
        ...DEFAULT_NOTIFICATION_POLICY,
        for_not_following: 'filter'
      })

      const request = new NextRequest(
        'https://llun.test/api/v1/notifications/policy',
        {
          method,
          body: JSON.stringify({
            filter_not_following: true,
            filter_new_accounts: false
          })
        }
      )

      const response = await handler(request, params)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(mockDatabase.updateNotificationPolicy).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        for_not_following: 'filter',
        for_new_accounts: 'accept'
      })
      expect(data.filter_not_following).toBe(true)
      expect(data.summary).toEqual({
        pending_requests_count: 1,
        pending_notifications_count: 3
      })
    }
  )

  it('accepts form-encoded legacy booleans', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/policy',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'filter_private_mentions=true&filter_not_followers=false'
      }
    )

    const response = await PUT(request, params)

    expect(response.status).toBe(200)
    expect(mockDatabase.updateNotificationPolicy).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      for_private_mentions: 'filter',
      for_not_followers: 'accept'
    })
  })

  it('returns 422 for a non-scalar value', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/policy',
      {
        method: 'PUT',
        body: JSON.stringify({ filter_not_following: { nested: true } })
      }
    )

    const response = await PUT(request, params)

    expect(response.status).toBe(422)
    expect(mockDatabase.updateNotificationPolicy).not.toHaveBeenCalled()
  })
})

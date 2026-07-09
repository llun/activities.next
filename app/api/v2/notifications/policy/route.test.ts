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
          params: Promise<{}>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, {
        currentActor: mockCurrentActor,
        database: mockDatabase,
        params: context.params
      }),
  OAuthGuardAnyScope:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          currentActor: typeof mockCurrentActor
          database: typeof mockDatabase
          params: Promise<{}>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, {
        currentActor: mockCurrentActor,
        database: mockDatabase,
        params: context.params
      })
}))

describe('/api/v2/notifications/policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getNotificationPolicy.mockResolvedValue({
      ...DEFAULT_NOTIFICATION_POLICY
    })
    mockDatabase.getNotificationsCount.mockResolvedValue(3)
    mockDatabase.getNotificationRequestsCount.mockResolvedValue(1)
  })

  it('returns the policy with a pending-counts summary', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v2/notifications/policy',
      { method: 'GET' }
    )

    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      for_not_following: 'accept',
      summary: { pending_requests_count: 1, pending_notifications_count: 3 }
    })
    expect(mockDatabase.getNotificationsCount).toHaveBeenCalledWith(
      expect.objectContaining({ filteredOnly: true })
    )
  })

  it('updates the policy on PATCH and echoes the result', async () => {
    mockDatabase.updateNotificationPolicy.mockResolvedValue({
      ...DEFAULT_NOTIFICATION_POLICY,
      for_not_following: 'filter'
    })
    mockDatabase.getNotificationPolicy.mockResolvedValue({
      ...DEFAULT_NOTIFICATION_POLICY,
      for_not_following: 'filter'
    })

    const request = new NextRequest(
      'https://llun.test/api/v2/notifications/policy',
      {
        method: 'PATCH',
        body: JSON.stringify({ for_not_following: 'filter' })
      }
    )

    const response = await PATCH(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.for_not_following).toBe('filter')
    expect(mockDatabase.updateNotificationPolicy).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      for_not_following: 'filter'
    })
  })

  it('updates the policy on PUT exactly like PATCH (Rails routes both verbs)', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v2/notifications/policy',
      {
        method: 'PUT',
        body: JSON.stringify({ for_not_following: 'filter' })
      }
    )

    const response = await PUT(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDatabase.updateNotificationPolicy).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      for_not_following: 'filter'
    })
  })

  it('returns 422 for an invalid policy value', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v2/notifications/policy',
      {
        method: 'PATCH',
        body: JSON.stringify({ for_not_following: 'nonsense' })
      }
    )

    const response = await PATCH(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(422)
    expect(mockDatabase.updateNotificationPolicy).not.toHaveBeenCalled()
  })
})

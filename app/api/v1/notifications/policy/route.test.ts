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

vi.mock('@/lib/services/guards/OAuthGuard', () => {
  const passthroughGuard =
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
  return {
    OAuthGuard: passthroughGuard,
    OAuthGuardAnyScope: passthroughGuard
  }
})

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

  // Mastodon coerces the legacy filter_* booleans with
  // ActiveModel::Type::Boolean: only a fixed set of false tokens map to false,
  // everything else is true. Cover each token so a regression that shrinks the
  // FALSE_TOKENS set (e.g. to just 'false') is caught instead of silently
  // flipping a user's policy from accept to filter.
  it.each([
    // Form-encoded string tokens (how HTML forms and pre-4.3 clients post).
    { label: "form 'false'", kind: 'form', raw: 'false', expected: 'accept' },
    { label: "form 'f'", kind: 'form', raw: 'f', expected: 'accept' },
    { label: "form '0'", kind: 'form', raw: '0', expected: 'accept' },
    { label: "form 'off'", kind: 'form', raw: 'off', expected: 'accept' },
    { label: 'form empty string', kind: 'form', raw: '', expected: 'accept' },
    { label: "form 'FALSE'", kind: 'form', raw: 'FALSE', expected: 'accept' },
    { label: "form 'true'", kind: 'form', raw: 'true', expected: 'filter' },
    { label: "form '1'", kind: 'form', raw: '1', expected: 'filter' },
    { label: "form 'on'", kind: 'form', raw: 'on', expected: 'filter' },
    { label: "form 'yes'", kind: 'form', raw: 'yes', expected: 'filter' },
    // JSON numeric coercion: 0 is false, any non-zero is true.
    { label: 'json number 0', kind: 'json', raw: 0, expected: 'accept' },
    { label: 'json number 1', kind: 'json', raw: 1, expected: 'filter' },
    { label: 'json number 2', kind: 'json', raw: 2, expected: 'filter' }
  ])(
    'coerces $label to for_not_following=$expected',
    async ({ kind, raw, expected }) => {
      const request =
        kind === 'form'
          ? new NextRequest('https://llun.test/api/v1/notifications/policy', {
              method: 'PUT',
              headers: {
                'content-type': 'application/x-www-form-urlencoded'
              },
              body: `filter_not_following=${encodeURIComponent(String(raw))}`
            })
          : new NextRequest('https://llun.test/api/v1/notifications/policy', {
              method: 'PUT',
              body: JSON.stringify({ filter_not_following: raw })
            })

      const response = await PUT(request, params)

      expect(response.status).toBe(200)
      expect(mockDatabase.updateNotificationPolicy).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        for_not_following: expected
      })
    }
  )

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

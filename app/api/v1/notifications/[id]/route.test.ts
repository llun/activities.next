import { NextRequest } from 'next/server'

import { GET, POST } from './route'

const mockDatabase = {
  getNotifications: jest.fn(),
  deleteNotification: jest.fn(),
  getActiveFiltersForActor: jest.fn().mockResolvedValue([])
}

const mockCurrentActor = {
  id: 'https://llun.test/users/llun'
}

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/services/notifications/getMastodonNotification', () => ({
  getMastodonNotification: jest.fn().mockResolvedValue({
    id: 'n1',
    type: 'follow',
    created_at: '2026-01-01T00:00:00Z',
    account: {}
  })
}))

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          currentActor: typeof mockCurrentActor
          database: typeof mockDatabase
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        currentActor: mockCurrentActor,
        database: mockDatabase,
        params: context.params
      })
}))

describe('GET /api/v1/notifications/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('fetches with includeFiltered: true so filtered notifications are visible by ID', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([
      {
        id: 'n1',
        type: 'follow',
        sourceActorId: 'https://other.test/users/alice',
        filtered: true
      }
    ])

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/n1',
      { method: 'GET' }
    )

    const response = await GET(request, {
      params: Promise.resolve({ id: 'n1' })
    })

    expect(response.status).toBe(200)
    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        ids: ['n1'],
        includeFiltered: true
      })
    )
  })

  it('returns 404 when notification does not exist', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([])

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/missing',
      { method: 'GET' }
    )

    const response = await GET(request, {
      params: Promise.resolve({ id: 'missing' })
    })

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/notifications/:id (dismiss)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('dismisses with includeFiltered: true so filtered notifications can be dismissed by ID', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([
      {
        id: 'n1',
        type: 'follow',
        sourceActorId: 'https://other.test/users/alice',
        filtered: true
      }
    ])
    mockDatabase.deleteNotification.mockResolvedValueOnce(undefined)

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/n1',
      { method: 'POST' }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'n1' })
    })

    expect(response.status).toBe(200)
    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        ids: ['n1'],
        includeFiltered: true
      })
    )
    expect(mockDatabase.deleteNotification).toHaveBeenCalledWith('n1')
  })

  it('returns 404 when notification does not exist', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([])

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications/missing',
      { method: 'POST' }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'missing' })
    })

    expect(response.status).toBe(404)
    expect(mockDatabase.deleteNotification).not.toHaveBeenCalled()
  })
})

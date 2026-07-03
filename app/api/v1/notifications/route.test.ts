import { NextRequest } from 'next/server'

import { GET, POST } from './route'

const mockDatabase = {
  getNotifications: vi.fn(),
  deleteNotification: vi.fn(),
  getActiveFiltersForActor: vi.fn().mockResolvedValue([]),
  getActiveServerFilters: vi.fn().mockResolvedValue([])
}

const mockCurrentActor = {
  id: 'https://llun.test/users/llun'
}

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
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
      }),
  OAuthGuardAnyScope:
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

describe('GET /api/v1/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clamps an out-of-range limit up to the minimum instead of rejecting it', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([])

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications?limit=0',
      { method: 'GET' }
    )

    const response = await GET(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 })
    )
  })

  it('clamps an above-max limit down to the maximum instead of rejecting it', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([])

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications?limit=100',
      { method: 'GET' }
    )

    const response = await GET(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 80 })
    )
  })

  it('normalizes a single types[] query parameter to an array', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([])

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications?types[]=favourite',
      { method: 'GET' }
    )

    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual([])
    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        types: ['like']
      })
    )
  })

  it('excludes filtered notifications by default', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([])

    const request = new NextRequest('https://llun.test/api/v1/notifications', {
      method: 'GET'
    })

    await GET(request, { params: Promise.resolve({}) })

    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        includeFiltered: false
      })
    )
  })

  it('passes include_filtered=true through to the database', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([])

    const request = new NextRequest(
      'https://llun.test/api/v1/notifications?include_filtered=true',
      { method: 'GET' }
    )

    await GET(request, { params: Promise.resolve({}) })

    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        includeFiltered: true
      })
    )
  })

  // min_id and since_id must reach the DB in their own slots — since_id must not
  // be collapsed into minNotificationId (which would give it adjacent-page
  // instead of newest-slice semantics).
  it.each([
    [
      'min_id=cursor-a',
      { minNotificationId: 'cursor-a', sinceNotificationId: undefined }
    ],
    [
      'since_id=cursor-b',
      { sinceNotificationId: 'cursor-b', minNotificationId: undefined }
    ]
  ])('routes %s to its own cursor param', async (query, expected) => {
    mockDatabase.getNotifications.mockResolvedValueOnce([])

    const request = new NextRequest(
      `https://llun.test/api/v1/notifications?${query}`,
      { method: 'GET' }
    )
    await GET(request, { params: Promise.resolve({}) })

    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining(expected)
    )
  })

  it.each([
    ['1', true],
    ['on', true],
    ['ON', true],
    ['True', true],
    ['false', false],
    ['0', false],
    ['off', false]
  ])(
    'parses include_filtered=%s as %s (Mastodon boolean compat)',
    async (value, expected) => {
      mockDatabase.getNotifications.mockResolvedValueOnce([])

      const request = new NextRequest(
        `https://llun.test/api/v1/notifications?include_filtered=${value}`,
        { method: 'GET' }
      )

      await GET(request, { params: Promise.resolve({}) })

      expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ includeFiltered: expected })
      )
    }
  )
})

describe('POST /api/v1/notifications (clear-all)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches notifications with includeFiltered: true so filtered notifications are cleared', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([])

    const request = new NextRequest('https://llun.test/api/v1/notifications', {
      method: 'POST'
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: mockCurrentActor.id,
        includeFiltered: true
      })
    )
  })
})

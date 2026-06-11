import { NextRequest } from 'next/server'

import { GET, POST } from './route'

const mockDatabase = {
  getNotifications: jest.fn(),
  deleteNotification: jest.fn(),
  getActiveFiltersForActor: jest.fn().mockResolvedValue([]),
  getActiveServerFilters: jest.fn().mockResolvedValue([])
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

describe('GET /api/v1/notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 422 when notification query parameters fail schema validation', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v1/notifications?limit=0',
      { method: 'GET' }
    )

    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.status).toBe('Unprocessable entity')
    expect(mockDatabase.getNotifications).not.toHaveBeenCalled()
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
    jest.clearAllMocks()
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

import { NextRequest } from 'next/server'

import { GET } from './route'

const mockDatabase = {
  getNotifications: jest.fn(),
  deleteNotification: jest.fn()
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
})

import { NextRequest } from 'next/server'

import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockDatabase = {
  getNotificationRequest: vi.fn(),
  acceptNotificationRequests: vi.fn(),
  getActorSettings: vi.fn().mockResolvedValue(undefined),
  updateActor: vi.fn().mockResolvedValue(null)
}

const mockCurrentActor = { id: 'https://llun.test/users/llun' }
const SOURCE_ACTOR_ID = 'https://other.test/users/stranger'

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
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, { currentActor: mockCurrentActor, params: context.params })
}))

describe('POST /api/v1/notifications/requests/[id]/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts the request and clears the filtered flag', async () => {
    mockDatabase.getNotificationRequest.mockResolvedValueOnce({
      sourceActorId: SOURCE_ACTOR_ID,
      notificationsCount: 2
    })

    const id = urlToId(SOURCE_ACTOR_ID)
    const request = new NextRequest(
      `https://llun.test/api/v1/notifications/requests/${id}/accept`,
      { method: 'POST' }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id })
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({})
    expect(mockDatabase.acceptNotificationRequests).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      sourceActorIds: [SOURCE_ACTOR_ID]
    })
  })

  it('returns 404 when the request does not exist', async () => {
    mockDatabase.getNotificationRequest.mockResolvedValueOnce(null)

    const id = urlToId(SOURCE_ACTOR_ID)
    const request = new NextRequest(
      `https://llun.test/api/v1/notifications/requests/${id}/accept`,
      { method: 'POST' }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(404)
    expect(mockDatabase.acceptNotificationRequests).not.toHaveBeenCalled()
  })
})

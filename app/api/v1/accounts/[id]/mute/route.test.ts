import { NextRequest } from 'next/server'

import { applyMute } from '@/lib/actions/applyMute'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockDatabase = {
  getActorFromId: jest.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me',
  domain: 'local.test'
}

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

jest.mock('@/lib/actions/applyMute', () => ({
  applyMute: jest.fn()
}))

jest.mock('@/lib/services/accounts/relationship', () => ({
  getRelationship: jest.fn()
}))

const createRequest = (
  targetActorId: string,
  body?: Record<string, unknown>
) => {
  const req = new NextRequest(
    `https://local.test/api/v1/accounts/${urlToId(targetActorId)}/mute`,
    {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { 'content-type': 'application/json' } : {}
    }
  )
  return req
}

describe('POST /api/v1/accounts/:id/mute', () => {
  const applyMuteMock = applyMute as jest.Mock
  const getRelationshipMock = getRelationship as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase.getActorFromId.mockResolvedValue({
      id: 'https://remote.test/users/alice'
    })
    getRelationshipMock.mockResolvedValue({
      id: 'target-id',
      muting: true,
      muting_notifications: true
    })
  })

  it('calls applyMute with notifications=true by default', async () => {
    const targetActorId = 'https://remote.test/users/alice'
    applyMuteMock.mockResolvedValue({})

    await POST(createRequest(targetActorId), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    expect(applyMuteMock).toHaveBeenCalledWith({
      database: mockDatabase,
      actorId: mockCurrentActor.id,
      targetActorId,
      notifications: true,
      endsAt: null
    })
  })

  it('calls applyMute with notifications=false when specified', async () => {
    const targetActorId = 'https://remote.test/users/alice'
    applyMuteMock.mockResolvedValue({})

    await POST(createRequest(targetActorId, { notifications: false }), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    expect(applyMuteMock).toHaveBeenCalledWith(
      expect.objectContaining({ notifications: false })
    )
  })

  it('computes endsAt from positive duration', async () => {
    const targetActorId = 'https://remote.test/users/alice'
    applyMuteMock.mockResolvedValue({})
    const before = Date.now()

    await POST(createRequest(targetActorId, { duration: 3600 }), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    const call = applyMuteMock.mock.calls[0][0]
    expect(call.endsAt).toBeGreaterThanOrEqual(before + 3600 * 1000)
    expect(call.endsAt).toBeLessThan(before + 3601 * 1000)
  })

  it('treats negative duration as no expiry', async () => {
    const targetActorId = 'https://remote.test/users/alice'
    applyMuteMock.mockResolvedValue({})

    await POST(createRequest(targetActorId, { duration: -60 }), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    expect(applyMuteMock).toHaveBeenCalledWith(
      expect.objectContaining({ endsAt: null })
    )
  })

  it('floors fractional duration to integer seconds', async () => {
    const targetActorId = 'https://remote.test/users/alice'
    applyMuteMock.mockResolvedValue({})
    const before = Date.now()

    await POST(createRequest(targetActorId, { duration: 3600.9 }), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    const call = applyMuteMock.mock.calls[0][0]
    expect(call.endsAt).toBeGreaterThanOrEqual(before + 3600 * 1000)
    expect(call.endsAt).toBeLessThan(before + 3601 * 1000)
  })

  it('skips applyMute when muting self', async () => {
    await POST(createRequest(mockCurrentActor.id), {
      params: Promise.resolve({ id: urlToId(mockCurrentActor.id) })
    })

    expect(applyMuteMock).not.toHaveBeenCalled()
    expect(getRelationshipMock).toHaveBeenCalled()
  })

  it('handles empty body gracefully', async () => {
    const targetActorId = 'https://remote.test/users/alice'
    applyMuteMock.mockResolvedValue({})

    const response = await POST(createRequest(targetActorId), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    expect(response.status).not.toBe(500)
    expect(applyMuteMock).toHaveBeenCalledWith(
      expect.objectContaining({ notifications: true, endsAt: null })
    )
  })

  it('returns 404 when target actor does not exist', async () => {
    const targetActorId = 'https://remote.test/users/unknown'
    mockDatabase.getActorFromId.mockResolvedValue(null)

    const response = await POST(createRequest(targetActorId), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    expect(response.status).toBe(404)
    expect(applyMuteMock).not.toHaveBeenCalled()
  })

  it('ignores invalid duration values (non-finite or non-integer body)', async () => {
    const targetActorId = 'https://remote.test/users/alice'
    applyMuteMock.mockResolvedValue({})

    await POST(
      createRequest(targetActorId, { duration: Infinity }),
      {
        params: Promise.resolve({ id: urlToId(targetActorId) })
      }
    )

    expect(applyMuteMock).toHaveBeenCalledWith(
      expect.objectContaining({ endsAt: null })
    )
  })
})

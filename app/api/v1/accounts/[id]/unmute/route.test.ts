import { NextRequest } from 'next/server'

import { applyUnmute } from '@/lib/actions/applyUnmute'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockMuteRecord = {
  id: 'mute-1',
  actorId: 'https://local.test/users/me',
  targetActorId: 'https://remote.test/users/alice',
  notifications: true,
  endsAt: null
}

const mockDatabase = {
  getMute: jest.fn(),
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

jest.mock('@/lib/actions/applyUnmute', () => ({
  applyUnmute: jest.fn()
}))

jest.mock('@/lib/services/accounts/relationship', () => ({
  getRelationship: jest.fn()
}))

const createRequest = (targetActorId: string) =>
  new NextRequest(
    `https://local.test/api/v1/accounts/${urlToId(targetActorId)}/unmute`,
    { method: 'POST' }
  )

describe('POST /api/v1/accounts/:id/unmute', () => {
  const applyUnmuteMock = applyUnmute as jest.Mock
  const getRelationshipMock = getRelationship as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase.getMute.mockResolvedValue(mockMuteRecord)
    mockDatabase.getActorFromId.mockResolvedValue({
      id: 'https://remote.test/users/alice'
    })
    getRelationshipMock.mockResolvedValue({
      id: 'target-id',
      muting: false,
      muting_notifications: false
    })
  })

  it('calls applyUnmute with the correct params when mute exists', async () => {
    const targetActorId = 'https://remote.test/users/alice'
    applyUnmuteMock.mockResolvedValue(null)

    await POST(createRequest(targetActorId), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    expect(applyUnmuteMock).toHaveBeenCalledWith({
      database: mockDatabase,
      actorId: mockCurrentActor.id,
      targetActorId
    })
    expect(getRelationshipMock).toHaveBeenCalled()
  })

  it('is a no-op (does not call applyUnmute) when unmuting self', async () => {
    await POST(createRequest(mockCurrentActor.id), {
      params: Promise.resolve({ id: urlToId(mockCurrentActor.id) })
    })

    expect(applyUnmuteMock).not.toHaveBeenCalled()
    expect(getRelationshipMock).toHaveBeenCalled()
  })

  it('succeeds even if target was not muted (no-op unmute)', async () => {
    const targetActorId = 'https://remote.test/users/alice'
    mockDatabase.getMute.mockResolvedValue(null)
    mockDatabase.getActorFromId.mockResolvedValue({
      id: targetActorId
    })
    applyUnmuteMock.mockResolvedValue(null)

    const response = await POST(createRequest(targetActorId), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    expect(response.status).not.toBe(404)
    expect(response.status).not.toBe(500)
    expect(applyUnmuteMock).not.toHaveBeenCalled()
  })

  it('returns 404 when target actor does not exist and no mute record', async () => {
    const targetActorId = 'https://remote.test/users/unknown'
    mockDatabase.getMute.mockResolvedValue(null)
    mockDatabase.getActorFromId.mockResolvedValue(null)

    const response = await POST(createRequest(targetActorId), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    expect(response.status).toBe(404)
    expect(applyUnmuteMock).not.toHaveBeenCalled()
  })
})

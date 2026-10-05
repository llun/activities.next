import { NextRequest } from 'next/server'

import { applyBlock } from '@/lib/actions/applyBlock'
import {
  BlockedFederationDomainError,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockDatabase = {}
const mockCurrentActor = {
  id: 'https://local.test/users/me',
  domain: 'local.test'
}
const mockPublish = vi.fn()

vi.mock('@/lib/services/guards/OAuthGuard', async () => ({
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
      }),
  OAuthGuardAnyScope:
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

vi.mock('@/lib/actions/applyBlock', async () => ({
  applyBlock: vi.fn()
}))

vi.mock('@/lib/actions/utils', async () => {
  const actual = await vi.importActual('@/lib/actions/utils')
  return {
    ...actual,
    recordActorIfNeeded: vi.fn()
  }
})

vi.mock('@/lib/services/accounts/relationship', async () => ({
  getRelationship: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: () => ({ publish: mockPublish })
}))

const createRequest = (targetActorId: string) =>
  new NextRequest(
    `https://local.test/api/v1/accounts/${urlToId(targetActorId)}/block`,
    { method: 'POST' }
  )

describe('POST /api/v1/accounts/:id/block', () => {
  const recordActorIfNeededMock = recordActorIfNeeded as jest.Mock
  const applyBlockMock = applyBlock as jest.Mock
  const getRelationshipMock = getRelationship as jest.Mock

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns forbidden when the target actor domain is blocked', async () => {
    const targetActorId = 'https://blocked.test/users/alice'
    recordActorIfNeededMock.mockRejectedValueOnce(
      new BlockedFederationDomainError(targetActorId)
    )

    const response = await POST(createRequest(targetActorId), {
      params: Promise.resolve({ id: urlToId(targetActorId) })
    })

    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(response.status).toBe(403)
    expect(recordActorIfNeededMock).toHaveBeenCalledWith({
      actorId: targetActorId,
      database: mockDatabase
    })
    expect(applyBlockMock).not.toHaveBeenCalled()
    expect(getRelationshipMock).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  // recordActorIfNeeded keys a row on the id the actor's origin names, so an
  // alias URL comes back as another id; the block must point at that row.
  it('blocks the recorded actor id when the target is a same-origin alias', async () => {
    const aliasId = 'https://remote.test/@alice'
    const canonicalId = 'https://remote.test/users/alice'
    recordActorIfNeededMock.mockResolvedValueOnce({ id: canonicalId })
    applyBlockMock.mockResolvedValueOnce({ uri: 'https://local.test/b' })
    mockPublish.mockResolvedValueOnce(undefined)
    getRelationshipMock.mockResolvedValueOnce({ id: 'r' })

    const response = await POST(createRequest(aliasId), {
      params: Promise.resolve({ id: aliasId })
    })

    expect(response.status).toBe(200)
    expect(applyBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetActorId: canonicalId })
    )
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetActorId: canonicalId })
      })
    )
    expect(getRelationshipMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetActorId: canonicalId })
    )
  })

  it('does not block the current actor when an alias resolves to it', async () => {
    recordActorIfNeededMock.mockResolvedValueOnce({ id: mockCurrentActor.id })
    getRelationshipMock.mockResolvedValueOnce({ id: 'r' })

    const aliasId = 'https://local.test/@me'
    const response = await POST(createRequest(aliasId), {
      params: Promise.resolve({ id: aliasId })
    })

    expect(response.status).toBe(200)
    expect(applyBlockMock).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

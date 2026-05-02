import { NextRequest } from 'next/server'

import { POST } from './route'

const mockCanFederateWithDomain = jest.fn()
const mockCreateFollower = jest.fn()
const mockDeleteLike = jest.fn()
const mockVerifyAllows = jest.fn()
const mockDatabase = {
  deleteLike: (...params: unknown[]) => mockDeleteLike(...params)
}
type MockActor = {
  id: string
  username: string
  type: string
  privateKey?: string
}
let mockActor: MockActor = {
  id: 'https://activities.local/users/llun',
  username: 'llun',
  type: 'Person'
}

jest.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
}))

jest.mock('@/lib/services/guards/ActivityPubVerifyGuard', () => ({
  ActivityPubVerifySenderGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          params: Promise<{ username: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    async (
      req: NextRequest,
      context: { params: Promise<{ username: string }> }
    ) => {
      if (!(await mockVerifyAllows(req, context))) {
        return Response.json({ status: 'Bad Request' }, { status: 400 })
      }

      return handle(req, {
        database: mockDatabase,
        params: context.params
      })
    }
}))

jest.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
  OnlyLocalUserGuard:
    (
      handle: (
        database: typeof mockDatabase,
        actor: typeof mockActor,
        req: NextRequest,
        query: { params: Promise<{ username: string }> }
      ) => Promise<Response> | Response,
      options?: { allowFederationSigningActor?: boolean }
    ) =>
    (req: NextRequest, query: { params: Promise<{ username: string }> }) => {
      if (
        mockActor.username === '__instance__' &&
        !options?.allowFederationSigningActor
      ) {
        return new Response(null, { status: 404 })
      }

      return handle(mockDatabase, mockActor, req, query)
    }
}))

jest.mock('@/lib/actions/acceptFollowRequest', () => ({
  acceptFollowRequest: jest.fn()
}))

jest.mock('@/lib/actions/createFollower', () => ({
  createFollower: (...params: unknown[]) => mockCreateFollower(...params)
}))

jest.mock('@/lib/actions/like', () => ({
  likeRequest: jest.fn()
}))

jest.mock('@/lib/actions/rejectFollowRequest', () => ({
  rejectFollowRequest: jest.fn()
}))

jest.mock('@/lib/actions/undoFollowRequest', () => ({
  undoFollowRequest: jest.fn()
}))

const createFollowRequest = (username = 'llun') =>
  new NextRequest(`https://activities.local/api/users/${username}/inbox`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'https://remote.test/users/alice/follows/1',
      type: 'Follow',
      actor: 'https://remote.test/users/alice',
      object: `https://activities.local/users/${username}`
    })
  })

const createActorInboxActivityRequest = (type: string) =>
  new NextRequest('https://activities.local/api/users/llun/inbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: `https://remote.test/users/alice/activities/${type.toLowerCase()}`,
      type,
      actor: 'https://remote.test/users/alice',
      object: 'https://activities.local/users/llun'
    })
  })

describe('POST /api/users/[username]/inbox', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockActor = {
      id: 'https://activities.local/users/llun',
      username: 'llun',
      type: 'Person'
    }
    mockVerifyAllows.mockResolvedValue(true)
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockCreateFollower.mockResolvedValue({
      object: 'https://activities.local/users/llun'
    })
    mockDeleteLike.mockResolvedValue(undefined)
  })

  it('accepts verified deliveries to the headless signer inbox without creating state', async () => {
    mockActor = {
      id: 'https://activities.local/users/__instance__',
      username: '__instance__',
      type: 'Service',
      privateKey: 'private-key'
    }

    const response = await POST(createFollowRequest('__instance__'), {
      params: Promise.resolve({ username: '__instance__' })
    })

    expect(response.status).toBe(202)
    expect(mockVerifyAllows).toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockCreateFollower).not.toHaveBeenCalled()
  })

  it('rejects requests before processing when sender verification fails', async () => {
    mockVerifyAllows.mockResolvedValue(false)

    const response = await POST(createFollowRequest(), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(400)
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockCreateFollower).not.toHaveBeenCalled()
  })

  it('processes verified actor inbox requests', async () => {
    const response = await POST(createFollowRequest(), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(202)
    expect(mockVerifyAllows).toHaveBeenCalled()
    expect(mockCanFederateWithDomain).toHaveBeenCalledWith(
      mockDatabase,
      'https://remote.test/users/alice'
    )
    expect(mockCreateFollower).toHaveBeenCalledWith({
      database: mockDatabase,
      followRequest: expect.objectContaining({
        actor: 'https://remote.test/users/alice',
        type: 'Follow'
      })
    })
  })

  it.each(['Block', 'Flag', 'Move', 'Add', 'Remove', 'QuoteRequest'])(
    'accepts verified %s activities without treating them as malformed',
    async (activityType) => {
      const response = await POST(
        createActorInboxActivityRequest(activityType),
        {
          params: Promise.resolve({ username: 'llun' })
        }
      )

      expect(response.status).toBe(202)
      expect(mockCanFederateWithDomain).toHaveBeenCalledWith(
        mockDatabase,
        'https://remote.test/users/alice'
      )
      expect(mockCreateFollower).not.toHaveBeenCalled()
    }
  )

  it('accepts reference-only Undo activities without treating them as malformed', async () => {
    const response = await POST(createActorInboxActivityRequest('Undo'), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(202)
    expect(mockCanFederateWithDomain).toHaveBeenCalledWith(
      mockDatabase,
      'https://remote.test/users/alice'
    )
    expect(mockCreateFollower).not.toHaveBeenCalled()
  })

  it('treats partial Undo Like objects as accepted no-ops', async () => {
    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/undo-like',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: {
            id: 'https://remote.test/users/alice/likes/1',
            type: 'Like'
          }
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(202)
    expect(mockDeleteLike).not.toHaveBeenCalled()
  })

  it('uses the verified Undo actor when deleting likes', async () => {
    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/undo-like',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: {
            id: 'https://remote.test/users/alice/likes/1',
            type: 'Like',
            actor: 'https://remote.test/users/bob',
            object: 'https://activities.local/users/llun/statuses/1'
          }
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(202)
    expect(mockDeleteLike).toHaveBeenCalledWith({
      actorId: 'https://remote.test/users/alice',
      statusId: 'https://activities.local/users/llun/statuses/1'
    })
  })
})

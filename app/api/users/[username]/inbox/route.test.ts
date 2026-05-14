import { NextRequest } from 'next/server'

import { POST } from './route'

const mockCanFederateWithDomain = jest.fn()
const mockCreateFollower = jest.fn()
const mockDeleteLike = jest.fn()
const mockApplyRemoteBlock = jest.fn()
const mockApplyRemoteUnblock = jest.fn()
const mockUndoFollowRequest = jest.fn()
const mockVerifyAllows = jest.fn()
const mockDatabase = {
  deleteLike: (...params: unknown[]) => mockDeleteLike(...params)
}
const mockDefaultActivityBody = Symbol('defaultActivityBody')
let mockActivityBody: unknown = mockDefaultActivityBody
let mockConsumeRequestBody = false
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
          activityBody: unknown
          database: typeof mockDatabase
          params: Promise<{ username: string }>
          verifiedSenderActorId: string
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

      const activityBody =
        mockActivityBody === mockDefaultActivityBody
          ? await req
              .clone()
              .json()
              .catch(() => null)
          : mockActivityBody

      if (mockConsumeRequestBody) {
        await req.text().catch(() => null)
      }

      return handle(req, {
        activityBody,
        database: mockDatabase,
        params: context.params,
        verifiedSenderActorId: 'https://remote.test/users/alice'
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

jest.mock('@/lib/actions/applyRemoteBlock', () => ({
  applyRemoteBlock: (...params: unknown[]) => mockApplyRemoteBlock(...params)
}))

jest.mock('@/lib/actions/applyRemoteUnblock', () => ({
  applyRemoteUnblock: (...params: unknown[]) =>
    mockApplyRemoteUnblock(...params)
}))

jest.mock('@/lib/actions/like', () => ({
  likeRequest: jest.fn()
}))

jest.mock('@/lib/actions/rejectFollowRequest', () => ({
  rejectFollowRequest: jest.fn()
}))

jest.mock('@/lib/actions/undoFollowRequest', () => ({
  undoFollowRequest: (...params: unknown[]) => mockUndoFollowRequest(...params)
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
    mockApplyRemoteBlock.mockResolvedValue({
      actorId: 'https://remote.test/users/alice',
      targetActorId: 'https://activities.local/users/llun'
    })
    mockApplyRemoteUnblock.mockResolvedValue({
      actorId: 'https://remote.test/users/alice',
      targetActorId: 'https://activities.local/users/llun'
    })
    mockUndoFollowRequest.mockResolvedValue(true)
    mockActivityBody = mockDefaultActivityBody
    mockConsumeRequestBody = false
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

  it('processes verified actor inbox requests from guard activityBody after the request body is consumed', async () => {
    mockActivityBody = {
      id: 'https://remote.test/users/alice/follows/1',
      type: 'Follow',
      actor: 'https://remote.test/users/alice',
      object: 'https://activities.local/users/llun'
    }
    mockConsumeRequestBody = true

    const response = await POST(createFollowRequest(), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(202)
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

  it('rejects invalid JSON bodies without side effects', async () => {
    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"actor":"https://remote.test/users/alice",'
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(400)
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockCreateFollower).not.toHaveBeenCalled()
  })

  it('dispatches verified Block activities to applyRemoteBlock', async () => {
    const response = await POST(createActorInboxActivityRequest('Block'), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(202)
    expect(mockApplyRemoteBlock).toHaveBeenCalledWith({
      database: mockDatabase,
      activity: expect.objectContaining({
        actor: 'https://remote.test/users/alice',
        object: 'https://activities.local/users/llun',
        type: 'Block'
      }),
      targetActorId: 'https://activities.local/users/llun'
    })
  })

  it.each(['Flag', 'Move', 'Add', 'Remove', 'QuoteRequest'])(
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

  it('dispatches full Undo Block activities to applyRemoteUnblock', async () => {
    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/undo-block',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: {
            id: 'https://remote.test/users/alice#blocks/1',
            type: 'Block',
            actor: 'https://remote.test/users/alice',
            object: 'https://activities.local/users/llun'
          }
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(202)
    expect(mockApplyRemoteUnblock).toHaveBeenCalledWith({
      database: mockDatabase,
      actorId: 'https://remote.test/users/alice',
      object: expect.objectContaining({ type: 'Block' }),
      targetActorId: 'https://activities.local/users/llun'
    })
  })

  it('rejects full Undo Follow activities whose object actor does not match the activity actor', async () => {
    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/undo-follow',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: {
            id: 'https://remote.test/users/bob/follows/1',
            type: 'Follow',
            actor: 'https://remote.test/users/bob',
            object: 'https://activities.local/users/llun'
          }
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(403)
    expect(mockUndoFollowRequest).not.toHaveBeenCalled()
  })

  it('rejects full Undo Block activities whose object actor does not match the activity actor', async () => {
    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/undo-block',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: {
            id: 'https://remote.test/users/bob#blocks/1',
            type: 'Block',
            actor: 'https://remote.test/users/bob',
            object: 'https://activities.local/users/llun'
          }
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(403)
    expect(mockApplyRemoteUnblock).not.toHaveBeenCalled()
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

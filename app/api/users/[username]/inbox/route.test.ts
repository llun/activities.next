import { NextRequest } from 'next/server'

import { HANDLE_QUOTE_REQUEST_JOB_NAME } from '@/lib/jobs/names'
import { setupRecordingTracer } from '@/lib/testing/recordingTracer'

import { POST } from './route'
import {
  createActorInboxActivityRequest,
  createFollowRequest
} from './route.testUtils'

const mockPublish = vi.fn()
const mockCanFederateWithDomain = vi.fn()
const mockAcceptRelayRequest = vi.fn()
const mockRejectRelayRequest = vi.fn()
const mockCreateFollower = vi.fn()
const mockDeleteLike = vi.fn()
const mockApplyRemoteBlock = vi.fn()
const mockApplyRemoteUnblock = vi.fn()
const mockUndoFollowRequest = vi.fn()
const mockLikeRequest = vi.fn()
const mockEmojiReactionRequest = vi.fn()
const mockUndoEmojiReactionRequest = vi.fn()
const mockHandleQuoteResponse = vi.fn()
const mockAcceptFollowRequest = vi.fn()
const mockRejectFollowRequest = vi.fn()
const mockVerifyAllows = vi.fn()
const mockGetModerationStatesForActors = vi.fn()
const mockDatabase = {
  deleteLike: (...params: unknown[]) => mockDeleteLike(...params),
  getModerationStatesForActors: (...params: unknown[]) =>
    mockGetModerationStatesForActors(...params)
}
const mockDefaultActivityBody = Symbol('defaultActivityBody')
let mockActivityBody: unknown = mockDefaultActivityBody
let mockConsumeRequestBody = false
let mockForwarded = false
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

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis()
  }
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: mockLogger
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: (...params: unknown[]) => mockPublish(...params)
  })
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
}))

vi.mock('@/lib/services/guards/ActivityPubVerifyGuard', () => ({
  ActivityPubVerifySenderGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          activityBody: unknown
          database: typeof mockDatabase
          forwarded: boolean
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
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const activityBody =
        mockActivityBody === mockDefaultActivityBody
          ? await req
              .clone()
              .json()
              .catch(() => null)
          : mockActivityBody

      if (activityBody === null) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (mockConsumeRequestBody) {
        await req.text().catch(() => null)
      }

      return handle(req, {
        activityBody,
        database: mockDatabase,
        forwarded: mockForwarded,
        params: context.params,
        verifiedSenderActorId: 'https://remote.test/users/alice'
      })
    }
}))

vi.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
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

vi.mock('@/lib/actions/acceptFollowRequest', () => ({
  acceptFollowRequest: (...params: unknown[]) =>
    mockAcceptFollowRequest(...params)
}))

vi.mock('@/lib/actions/handleQuoteResponse', () => ({
  handleQuoteResponse: (...params: unknown[]) =>
    mockHandleQuoteResponse(...params)
}))

vi.mock('@/lib/actions/acceptRelayRequest', () => ({
  acceptRelayRequest: (...params: unknown[]) =>
    mockAcceptRelayRequest(...params),
  rejectRelayRequest: (...params: unknown[]) =>
    mockRejectRelayRequest(...params)
}))

vi.mock('@/lib/actions/createFollower', () => ({
  createFollower: (...params: unknown[]) => mockCreateFollower(...params)
}))

vi.mock('@/lib/actions/applyRemoteBlock', () => ({
  applyRemoteBlock: (...params: unknown[]) => mockApplyRemoteBlock(...params)
}))

vi.mock('@/lib/actions/applyRemoteUnblock', () => ({
  applyRemoteUnblock: (...params: unknown[]) =>
    mockApplyRemoteUnblock(...params)
}))

vi.mock('@/lib/actions/like', () => ({
  likeRequest: (...params: unknown[]) => mockLikeRequest(...params)
}))

vi.mock('@/lib/actions/emojiReaction', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/actions/emojiReaction')
  >('@/lib/actions/emojiReaction')
  return {
    // getReactionContent is a pure classifier the route branches on — keep the
    // real one so the tests exercise the actual Like/reaction fork.
    getReactionContent: actual.getReactionContent,
    emojiReactionRequest: (...params: unknown[]) =>
      mockEmojiReactionRequest(...params),
    undoEmojiReactionRequest: (...params: unknown[]) =>
      mockUndoEmojiReactionRequest(...params)
  }
})

vi.mock('@/lib/actions/rejectFollowRequest', () => ({
  rejectFollowRequest: (...params: unknown[]) =>
    mockRejectFollowRequest(...params)
}))

vi.mock('@/lib/actions/undoFollowRequest', () => ({
  undoFollowRequest: (...params: unknown[]) => mockUndoFollowRequest(...params)
}))

describe('POST /api/users/[username]/inbox', () => {
  let harness: ReturnType<typeof setupRecordingTracer>

  beforeEach(() => {
    harness = setupRecordingTracer()
    vi.clearAllMocks()
    // clearAllMocks keeps queued mock…Once values, so one queued for a call a
    // test's path never makes would answer the next test that does make it.
    // Reset every handle; the defaults below are set afresh each time.
    for (const mock of [
      mockPublish,
      mockCanFederateWithDomain,
      mockAcceptRelayRequest,
      mockRejectRelayRequest,
      mockCreateFollower,
      mockDeleteLike,
      mockApplyRemoteBlock,
      mockApplyRemoteUnblock,
      mockUndoFollowRequest,
      mockLikeRequest,
      mockEmojiReactionRequest,
      mockUndoEmojiReactionRequest,
      mockHandleQuoteResponse,
      mockAcceptFollowRequest,
      mockRejectFollowRequest,
      mockVerifyAllows,
      mockGetModerationStatesForActors
    ]) {
      mock.mockReset()
    }
    mockForwarded = false
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
    mockLikeRequest.mockResolvedValue(undefined)
    mockEmojiReactionRequest.mockResolvedValue(undefined)
    mockUndoEmojiReactionRequest.mockResolvedValue(undefined)
    mockGetModerationStatesForActors.mockResolvedValue(new Map())
    mockHandleQuoteResponse.mockResolvedValue(false)
    mockAcceptFollowRequest.mockResolvedValue({
      object: 'https://activities.local/users/llun'
    })
    mockRejectFollowRequest.mockResolvedValue({
      object: 'https://activities.local/users/llun'
    })
    mockActivityBody = mockDefaultActivityBody
    mockConsumeRequestBody = false
  })

  afterEach(() => {
    harness.cleanup()
  })

  it('returns 202 without side effects when the verified sender actor is suspended', async () => {
    mockGetModerationStatesForActors.mockResolvedValue(
      new Map([
        [
          'https://remote.test/users/alice',
          {
            suspendedAt: 1_700_000_000_000,
            silencedAt: null,
            sensitizedAt: null
          }
        ]
      ])
    )

    const response = await POST(createFollowRequest(), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(202)
    expect(mockCreateFollower).not.toHaveBeenCalled()
  })

  it('rejects requests before processing when sender verification fails', async () => {
    mockVerifyAllows.mockResolvedValue(false)

    const response = await POST(createFollowRequest(), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(401)
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
      }),
      recipientActorId: 'https://activities.local/users/llun'
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
      }),
      recipientActorId: 'https://activities.local/users/llun'
    })
  })

  it('processes verified actor inbox Follow request when object is an embedded actor object', async () => {
    mockActivityBody = {
      id: 'https://remote.test/users/alice/follows/2',
      type: 'Follow',
      actor: 'https://remote.test/users/alice',
      object: {
        id: 'https://activities.local/users/llun',
        type: 'Person'
      }
    }
    mockConsumeRequestBody = true

    const response = await POST(createFollowRequest(), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(202)
    expect(mockCreateFollower).toHaveBeenCalledWith({
      database: mockDatabase,
      followRequest: expect.objectContaining({
        actor: 'https://remote.test/users/alice',
        type: 'Follow',
        object: 'https://activities.local/users/llun'
      }),
      recipientActorId: 'https://activities.local/users/llun'
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

    expect(response.status).toBe(401)
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

  it.each(['Flag', 'Move', 'Add', 'Remove'])(
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

  it.each(['Flag', 'Move', 'Add', 'Remove'])(
    'accepts transient %s activities without an id with 202 Accepted',
    async (activityType) => {
      mockActivityBody = {
        type: activityType,
        actor: 'https://remote.test/users/alice',
        object: 'https://activities.local/users/llun'
      }

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

  it('dispatches verified QuoteRequest activities to the quote-request job', async () => {
    // The instrument-authorship check dereferences the remote note, so the
    // per-user inbox defers to the worker (like the shared inbox) instead of
    // running the handler inline in the response.
    const response = await POST(
      createActorInboxActivityRequest('QuoteRequest'),
      {
        params: Promise.resolve({ username: 'llun' })
      }
    )

    expect(response.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ name: HANDLE_QUOTE_REQUEST_JOB_NAME })
    )
  })

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

  it('dispatches reference-only Undo of Follow to undoFollowRequest and returns 202', async () => {
    mockApplyRemoteUnblock.mockResolvedValueOnce(null)

    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/undo-ref',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: 'https://activities.local/users/llun'
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(202)
    expect(mockUndoFollowRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        database: mockDatabase,
        request: expect.objectContaining({
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: expect.objectContaining({
            actor: 'https://remote.test/users/alice',
            object: 'https://activities.local/users/llun',
            type: 'Follow'
          })
        })
      })
    )
  })

  it('returns 202 instead of 404 when undoFollowRequest returns false (already undone or not found)', async () => {
    mockUndoFollowRequest.mockResolvedValueOnce(false)

    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/undo-follow',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: {
            id: 'https://remote.test/users/alice/follows/1',
            type: 'Follow',
            actor: 'https://remote.test/users/alice',
            object: 'https://activities.local/users/llun'
          }
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(202)
    expect(mockUndoFollowRequest).toHaveBeenCalled()
  })

  it('dispatches reference-object Undo of Follow without embedded actor to undoFollowRequest and returns 202', async () => {
    mockUndoFollowRequest.mockResolvedValueOnce(true)

    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/undo-ref-obj',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: {
            id: 'https://activities.local/follows/1',
            type: 'Follow'
          }
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(202)
    expect(mockUndoFollowRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        database: mockDatabase,
        request: expect.objectContaining({
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: expect.objectContaining({
            id: 'https://activities.local/follows/1',
            actor: 'https://remote.test/users/alice',
            object: 'https://activities.local/users/llun',
            type: 'Follow'
          })
        })
      })
    )
  })

  it('dispatches untyped reference-object Undo of Follow to undoFollowRequest and returns 202', async () => {
    mockUndoFollowRequest.mockResolvedValueOnce(true)

    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/undo-ref-obj-untyped',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: {
            id: 'https://activities.local/follows/1',
            custom: 'extra-property'
          }
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(202)
    expect(mockUndoFollowRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        database: mockDatabase,
        request: expect.objectContaining({
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: expect.objectContaining({
            id: 'https://activities.local/follows/1',
            actor: 'https://remote.test/users/alice',
            object: 'https://activities.local/users/llun',
            type: 'Follow'
          })
        })
      })
    )
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

  it('records exception, reject reason, and logs error when an action throws', async () => {
    mockCreateFollower.mockRejectedValue(new Error('db down'))

    const response = await POST(createFollowRequest('llun'), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(500)
    expect(harness.recordedSpans).toHaveLength(1)
    expect(harness.recordedSpans[0].name).toBe('api.actorInbox')
    expect(harness.recordedSpans[0].attributes).toMatchObject({
      'inbox.reject_reason': 'handler_exception',
      'inbox.sender_actor_id': 'https://remote.test/users/alice'
    })
    expect(harness.recordedSpans[0].exception).toEqual(new Error('db down'))
    expect(mockLogger.error).toHaveBeenCalledWith({
      err: expect.any(Error),
      message: 'ActivityPub inbox handler threw',
      senderActorId: 'https://remote.test/users/alice'
    })
    expect(mockLogger.error.mock.calls[0][0].err.message).toBe('db down')
  })

  describe('status activity routing on personal inbox', () => {
    it('routes Create Note activities delivered to personal inbox to the job queue with 202', async () => {
      const response = await POST(
        new NextRequest('https://activities.local/api/users/llun/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: 'https://remote.test/users/alice/activities/create-1',
            type: 'Create',
            actor: 'https://remote.test/users/alice',
            object: {
              id: 'https://remote.test/users/alice/statuses/1',
              type: 'Note',
              attributedTo: 'https://remote.test/users/alice',
              content: 'Hello'
            }
          })
        }),
        { params: Promise.resolve({ username: 'llun' }) }
      )

      expect(response.status).toBe(202)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'CreateNoteJob'
        })
      )
    })

    it('routes Announce activities delivered to personal inbox to the job queue with 202', async () => {
      const response = await POST(
        new NextRequest('https://activities.local/api/users/llun/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: 'https://remote.test/users/alice/activities/announce-1',
            type: 'Announce',
            actor: 'https://remote.test/users/alice',
            object: 'https://activities.local/users/llun/statuses/1',
            to: ['https://www.w3.org/ns/activitystreams#Public']
          })
        }),
        { params: Promise.resolve({ username: 'llun' }) }
      )

      expect(response.status).toBe(202)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'CreateAnnounceJob'
        })
      )
    })

    it('routes Delete activities delivered to personal inbox to the job queue with 202', async () => {
      const response = await POST(
        new NextRequest('https://activities.local/api/users/llun/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: 'https://remote.test/users/alice/activities/delete-1',
            type: 'Delete',
            actor: 'https://remote.test/users/alice',
            object: 'https://remote.test/users/alice/statuses/1'
          })
        }),
        { params: Promise.resolve({ username: 'llun' }) }
      )

      expect(response.status).toBe(202)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'DeleteObjectJob'
        })
      )
    })

    it('routes Undo Announce activities delivered to personal inbox to the job queue with 202', async () => {
      const response = await POST(
        new NextRequest('https://activities.local/api/users/llun/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: 'https://remote.test/users/alice/activities/undo-announce-1',
            type: 'Undo',
            actor: 'https://remote.test/users/alice',
            object: {
              id: 'https://remote.test/users/alice/activities/announce-1',
              type: 'Announce',
              actor: 'https://remote.test/users/alice',
              object: 'https://activities.local/users/llun/statuses/1'
            }
          })
        }),
        { params: Promise.resolve({ username: 'llun' }) }
      )

      expect(response.status).toBe(202)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'DeleteObjectJob'
        })
      )
    })
  })

  it('accepts unknown or unsupported activity types with 202 and logs without error', async () => {
    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/custom-1',
          type: 'Dislike',
          actor: 'https://remote.test/users/alice',
          object: 'https://activities.local/users/llun'
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(202)
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Accepted ActivityPub inbox activity without local side effects',
        reason: 'unsupported activity shape'
      })
    )
  })

  it('accepts string array activity_type with 202', async () => {
    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/custom-1',
          type: ['Create', 'https://example.com/Custom'],
          actor: 'https://remote.test/users/alice',
          object: 'https://activities.local/users/llun'
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(202)
  })

  it('does not annotate inbox.reject_reason on a valid accepted activity', async () => {
    const response = await POST(createFollowRequest('llun'), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(202)
    expect(harness.recordedSpans).toHaveLength(1)
    expect(
      harness.recordedSpans[0].attributes['inbox.reject_reason']
    ).toBeUndefined()
  })

  it('annotates sender_actor_mismatch and activity attributes on Undo Follow mismatch', async () => {
    const response = await POST(
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'https://remote.test/users/alice/activities/undo-1',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object: {
            id: 'https://remote.test/users/mallory/follows/1',
            type: 'Follow',
            actor: 'https://remote.test/users/mallory',
            object: 'https://activities.local/users/llun'
          }
        })
      }),
      { params: Promise.resolve({ username: 'llun' }) }
    )

    expect(response.status).toBe(403)
    expect(harness.recordedSpans).toHaveLength(1)
    expect(harness.recordedSpans[0].attributes).toMatchObject({
      'inbox.reject_reason': 'sender_actor_mismatch',
      'inbox.verified_sender': 'https://remote.test/users/alice',
      'inbox.activity_actor': 'https://remote.test/users/mallory',
      'inbox.activity_id': 'https://remote.test/users/alice/activities/undo-1',
      'inbox.activity_type': 'Undo',
      'inbox.activity_object_id': 'https://remote.test/users/mallory/follows/1',
      'inbox.activity_object_type': 'Follow'
    })
  })

  it('annotates domain_not_federatable with activity metadata in actor inbox', async () => {
    mockCanFederateWithDomain.mockResolvedValue(false)

    const response = await POST(createFollowRequest('llun'), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(403)
    expect(harness.recordedSpans).toHaveLength(1)
    expect(harness.recordedSpans[0].attributes).toMatchObject({
      'inbox.reject_reason': 'domain_not_federatable',
      'inbox.actor_id': 'https://remote.test/users/alice',
      'inbox.sender_actor_id': 'https://remote.test/users/alice',
      'inbox.activity_id': 'https://remote.test/users/alice/follows/1',
      'inbox.activity_type': 'Follow',
      'inbox.activity_object_id': 'https://activities.local/users/llun'
    })
  })
})

import { NextRequest } from 'next/server'

import { QUOTE_ACTIVITY_CONTEXT } from '@/lib/activities/quoteContext'
import { setupRecordingTracer } from '@/lib/testing/recordingTracer'

import { POST } from './route'

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

  describe('FEP-044f quote response', () => {
    const QUOTING_STATUS_ID =
      'https://activities.local/users/llun/statuses/01a039b7'
    const QUOTED_STATUS_ID =
      'https://remote.test/users/alice/statuses/117156466043215104'
    const STAMP_URI =
      'https://remote.test/users/alice/quote_authorizations/abc123'

    // The shape Mastodon 4.5 delivers when it approves our QuoteRequest: an
    // Accept whose `object` is the QuoteRequest we sent and whose `result` is
    // the hosted QuoteAuthorization stamp. Never an Accept(Follow).
    const quoteResponseRequest = (type: 'Accept' | 'Reject', object: unknown) =>
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          '@context': QUOTE_ACTIVITY_CONTEXT,
          id: `${STAMP_URI}#${type.toLowerCase()}`,
          type,
          actor: 'https://remote.test/users/alice',
          object,
          ...(type === 'Accept' ? { result: STAMP_URI } : null)
        })
      })

    const embeddedQuoteRequest = {
      id: `${QUOTING_STATUS_ID}#quote-request`,
      type: 'QuoteRequest',
      actor: 'https://activities.local/users/llun',
      object: QUOTED_STATUS_ID,
      instrument: QUOTING_STATUS_ID
    }

    it.each([
      {
        description: 'an embedded QuoteRequest object',
        object: embeddedQuoteRequest,
        // handleQuoteResponse reads the QuoteRequest id off `object`, so that is
        // the field the two cases differ in and the one worth asserting: if
        // compaction dropped or restructured it the edge would never match and
        // the quote would stay pending — the bug this route change fixes.
        expectedObject: expect.objectContaining({
          id: `${QUOTING_STATUS_ID}#quote-request`
        })
      },
      {
        description: 'a bare QuoteRequest id string',
        object: `${QUOTING_STATUS_ID}#quote-request`,
        expectedObject: `${QUOTING_STATUS_ID}#quote-request`
      }
    ])(
      'settles an Accept carrying $description',
      async ({ object, expectedObject }) => {
        mockHandleQuoteResponse.mockResolvedValue(true)

        const response = await POST(quoteResponseRequest('Accept', object), {
          params: Promise.resolve({ username: 'llun' })
        })

        expect(response.status).toBe(202)
        expect(mockHandleQuoteResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            database: mockDatabase,
            activity: expect.objectContaining({
              type: 'Accept',
              object: expectedObject
            })
          })
        )
        // A quote response is not a follow handshake.
        expect(mockAcceptFollowRequest).not.toHaveBeenCalled()
      }
    )

    it('authorizes the handler on the signature-verified sender, not the document actor', async () => {
      // Compaction can rewrite `actor` via a sender-supplied context alias, and
      // the signature guard verified the RAW body. The route must hand the
      // handler the identity the signature actually proved.
      mockHandleQuoteResponse.mockResolvedValue(true)

      await POST(quoteResponseRequest('Accept', embeddedQuoteRequest), {
        params: Promise.resolve({ username: 'llun' })
      })

      expect(mockHandleQuoteResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          verifiedSenderActorId: 'https://remote.test/users/alice'
        })
      )
    })

    it('forwards the hosted stamp uri on the Accept it hands to the handler', async () => {
      mockHandleQuoteResponse.mockResolvedValue(true)

      await POST(quoteResponseRequest('Accept', embeddedQuoteRequest), {
        params: Promise.resolve({ username: 'llun' })
      })

      expect(mockHandleQuoteResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: expect.objectContaining({ result: STAMP_URI })
        })
      )
    })

    it('settles a Reject carrying a QuoteRequest object', async () => {
      mockHandleQuoteResponse.mockResolvedValue(true)

      const response = await POST(
        quoteResponseRequest('Reject', embeddedQuoteRequest),
        { params: Promise.resolve({ username: 'llun' }) }
      )

      expect(response.status).toBe(202)
      expect(mockHandleQuoteResponse).toHaveBeenCalledTimes(1)
      expect(mockRejectFollowRequest).not.toHaveBeenCalled()
    })

    it.each([{ type: 'Accept' as const }, { type: 'Reject' as const }])(
      'acknowledges a $type carrying a non-Follow object that matches no quote',
      async ({ type }) => {
        mockHandleQuoteResponse.mockResolvedValue(false)

        const response = await POST(
          quoteResponseRequest(type, embeddedQuoteRequest),
          { params: Promise.resolve({ username: 'llun' }) }
        )

        // Acknowledged without side effects rather than 400'd: the activity is
        // well formed, we simply hold no record it settles.
        expect(response.status).toBe(202)
        expect(mockAcceptFollowRequest).not.toHaveBeenCalled()
        expect(mockRejectFollowRequest).not.toHaveBeenCalled()
      }
    )

    it.each([
      {
        type: 'Accept' as const,
        handler: () => mockAcceptFollowRequest,
        other: () => mockRejectFollowRequest
      },
      {
        type: 'Reject' as const,
        handler: () => mockRejectFollowRequest,
        other: () => mockAcceptFollowRequest
      }
    ])(
      'still routes a $type(Follow) to the follow handshake',
      async ({ type, handler, other }) => {
        mockHandleQuoteResponse.mockResolvedValue(false)

        const response = await POST(
          quoteResponseRequest(type, {
            id: 'https://activities.local/follows/1',
            type: 'Follow',
            actor: 'https://activities.local/users/llun',
            object: 'https://remote.test/users/alice'
          }),
          { params: Promise.resolve({ username: 'llun' }) }
        )

        expect(response.status).toBe(202)
        expect(handler()).toHaveBeenCalledTimes(1)
        // The follow handlers dereference `activity.object.id`, so the branch
        // must hand them the strict Follow shape, never the passthrough one.
        expect(handler()).toHaveBeenCalledWith(
          expect.objectContaining({
            activity: expect.objectContaining({
              object: expect.objectContaining({
                type: 'Follow',
                id: 'https://activities.local/follows/1'
              })
            })
          })
        )
        expect(other()).not.toHaveBeenCalled()
      }
    )

    it.each([
      {
        type: 'Accept' as const,
        handler: () => mockAcceptFollowRequest
      },
      {
        type: 'Reject' as const,
        handler: () => mockRejectFollowRequest
      }
    ])(
      'routes a $type with a string URI object (Lemmy/PeerTube style) to follow handshake',
      async ({ type, handler }) => {
        mockHandleQuoteResponse.mockResolvedValue(false)

        const response = await POST(
          quoteResponseRequest(type, 'https://activities.local/follows/1'),
          { params: Promise.resolve({ username: 'llun' }) }
        )

        expect(response.status).toBe(202)
        expect(handler()).toHaveBeenCalledWith(
          expect.objectContaining({
            database: mockDatabase,
            recipientActorId: 'https://activities.local/users/llun',
            activity: expect.objectContaining({
              type,
              object: 'https://activities.local/follows/1'
            })
          })
        )
      }
    )

    it.each([
      {
        type: 'Accept' as const,
        handler: () => mockAcceptFollowRequest
      },
      {
        type: 'Reject' as const,
        handler: () => mockRejectFollowRequest
      }
    ])(
      'returns 202 instead of 404 when $type follow is not found',
      async ({ type, handler }) => {
        mockHandleQuoteResponse.mockResolvedValue(false)
        handler().mockResolvedValue(null)

        const response = await POST(
          quoteResponseRequest(type, 'https://activities.local/follows/1'),
          { params: Promise.resolve({ username: 'llun' }) }
        )

        expect(response.status).toBe(202)
      }
    )

    it('does not reach the quote handler when the sender domain is blocked', async () => {
      mockCanFederateWithDomain.mockResolvedValue(false)

      const response = await POST(
        quoteResponseRequest('Accept', embeddedQuoteRequest),
        { params: Promise.resolve({ username: 'llun' }) }
      )

      expect(response.status).toBe(403)
      expect(mockHandleQuoteResponse).not.toHaveBeenCalled()
    })

    it('does not reach the quote handler when the sender is suspended', async () => {
      mockGetModerationStatesForActors.mockResolvedValue(
        new Map([
          [
            'https://remote.test/users/alice',
            { suspendedAt: 1_700_000_000_000, silencedAt: null }
          ]
        ])
      )

      const response = await POST(
        quoteResponseRequest('Accept', embeddedQuoteRequest),
        { params: Promise.resolve({ username: 'llun' }) }
      )

      expect(response.status).toBe(202)
      expect(mockHandleQuoteResponse).not.toHaveBeenCalled()
    })
  })
})

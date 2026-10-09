import { NextRequest } from 'next/server'

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

  describe('emoji reactions', () => {
    const inboxRequest = (body: Record<string, unknown>) =>
      new NextRequest('https://activities.local/api/users/llun/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    const post = (body: Record<string, unknown>) =>
      POST(inboxRequest(body), {
        params: Promise.resolve({ username: 'llun' })
      })

    const statusId = 'https://activities.local/users/llun/statuses/1'
    const emojiReact = {
      id: 'https://remote.test/users/alice#emoji-reactions/1',
      type: 'EmojiReact',
      actor: 'https://remote.test/users/alice',
      object: statusId,
      content: '\u{1F525}'
    }
    const misskeyLike = {
      id: 'https://remote.test/users/alice#likes/1',
      type: 'Like',
      actor: 'https://remote.test/users/alice',
      object: statusId,
      content: '\u{1F525}',
      _misskey_reaction: '\u{1F525}'
    }
    const plainLike = {
      id: 'https://remote.test/users/alice#likes/2',
      type: 'Like',
      actor: 'https://remote.test/users/alice',
      object: statusId
    }

    it.each([
      { description: 'an EmojiReact', activity: emojiReact },
      { description: 'a Like carrying a reaction', activity: misskeyLike }
    ])('routes $description to emojiReactionRequest', async ({ activity }) => {
      const response = await post(activity)

      expect(response.status).toBe(202)
      expect(mockEmojiReactionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          database: mockDatabase,
          activity: expect.objectContaining({ content: '\u{1F525}' })
        })
      )
      // A reaction is never a favourite.
      expect(mockLikeRequest).not.toHaveBeenCalled()
    })

    it('keeps routing a plain Like to likeRequest', async () => {
      const response = await post(plainLike)

      expect(response.status).toBe(202)
      expect(mockLikeRequest).toHaveBeenCalledTimes(1)
      expect(mockEmojiReactionRequest).not.toHaveBeenCalled()
    })

    it.each([
      { description: 'an EmojiReact', object: emojiReact },
      { description: 'a Like carrying a reaction', object: misskeyLike }
    ])(
      'routes an Undo of $description to undoEmojiReactionRequest',
      async ({ object }) => {
        const response = await post({
          id: 'https://remote.test/users/alice/activities/undo-reaction',
          type: 'Undo',
          actor: 'https://remote.test/users/alice',
          object
        })

        expect(response.status).toBe(202)
        expect(mockUndoEmojiReactionRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            database: mockDatabase,
            activity: expect.objectContaining({
              actor: 'https://remote.test/users/alice',
              content: '\u{1F525}'
            })
          })
        )
        // The favourite is untouched.
        expect(mockDeleteLike).not.toHaveBeenCalled()
      }
    )

    it('keeps routing an Undo of a plain Like to deleteLike', async () => {
      const response = await post({
        id: 'https://remote.test/users/alice/activities/undo-like',
        type: 'Undo',
        actor: 'https://remote.test/users/alice',
        object: plainLike
      })

      expect(response.status).toBe(202)
      expect(mockDeleteLike).toHaveBeenCalledWith({
        actorId: 'https://remote.test/users/alice',
        statusId
      })
      expect(mockUndoEmojiReactionRequest).not.toHaveBeenCalled()
    })
  })

  describe('an inline @context cannot swap the verified actor during compaction', () => {
    // The guard verified the signer against the raw `actor` (alice). The
    // sender's own context nulls the plain `actor` term and smuggles a victim
    // in through the full ActivityStreams IRI, which compacts back to `actor`.
    const spoofed = (activity: Record<string, unknown>) => ({
      '@context': ['https://www.w3.org/ns/activitystreams', { actor: null }],
      ...activity,
      actor: 'https://remote.test/users/alice',
      'https://www.w3.org/ns/activitystreams#actor': {
        '@id': 'https://victim.test/users/bob'
      }
    })
    const send = (body: Record<string, unknown>) =>
      POST(
        new NextRequest('https://activities.local/api/users/llun/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        }),
        { params: Promise.resolve({ username: 'llun' }) }
      )

    it('applies a Like as the signed actor, not the smuggled one', async () => {
      const response = await send(
        spoofed({
          id: 'https://remote.test/users/alice/likes/spoof',
          type: 'Like',
          object: 'https://activities.local/users/llun/statuses/1'
        })
      )

      expect(response.status).toBe(202)
      expect(mockLikeRequest).toHaveBeenCalledTimes(1)
      expect(mockLikeRequest.mock.calls[0][0].activity.actor).toBe(
        'https://remote.test/users/alice'
      )
    })

    it('creates a Follow from the signed actor, not the smuggled one', async () => {
      const response = await send(
        spoofed({
          id: 'https://remote.test/users/alice/follows/spoof',
          type: 'Follow',
          object: 'https://activities.local/users/llun'
        })
      )

      expect(response.status).toBe(202)
      expect(mockCreateFollower).toHaveBeenCalledTimes(1)
      expect(mockCreateFollower.mock.calls[0][0].followRequest.actor).toBe(
        'https://remote.test/users/alice'
      )
    })
  })
})

import { NextRequest } from 'next/server'

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

  describe('relay handshake on the signer inbox', () => {
    const asSigner = () => {
      mockActor = {
        id: 'https://activities.local/users/__instance__',
        username: '__instance__',
        type: 'Service',
        privateKey: 'private-key'
      }
    }
    const handshakeRequest = (type: 'Accept' | 'Reject', object: unknown) =>
      new NextRequest('https://activities.local/api/users/__instance__/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `https://relay.example/activities/${type.toLowerCase()}`,
          type,
          actor: 'https://relay.example/actor',
          object
        })
      })

    it('routes a verified Accept to acceptRelayRequest (object as object)', async () => {
      asSigner()
      const response = await POST(
        handshakeRequest('Accept', {
          id: 'https://activities.local/relay-follow-1',
          type: 'Follow',
          actor: 'https://activities.local/users/__instance__',
          object: 'https://www.w3.org/ns/activitystreams#Public'
        }),
        { params: Promise.resolve({ username: '__instance__' }) }
      )

      expect(response.status).toBe(202)
      expect(mockAcceptRelayRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          database: mockDatabase,
          activity: expect.objectContaining({ type: 'Accept' })
        })
      )
      expect(mockRejectRelayRequest).not.toHaveBeenCalled()
    })

    it('routes a verified Accept whose object is a bare Follow id string', async () => {
      asSigner()
      const response = await POST(
        handshakeRequest('Accept', 'https://activities.local/relay-follow-1'),
        { params: Promise.resolve({ username: '__instance__' }) }
      )

      expect(response.status).toBe(202)
      expect(mockAcceptRelayRequest).toHaveBeenCalledTimes(1)
    })

    it('routes a verified Reject to rejectRelayRequest', async () => {
      asSigner()
      const response = await POST(
        handshakeRequest('Reject', {
          id: 'https://activities.local/relay-follow-1',
          type: 'Follow',
          actor: 'https://activities.local/users/__instance__',
          object: 'https://www.w3.org/ns/activitystreams#Public'
        }),
        { params: Promise.resolve({ username: '__instance__' }) }
      )

      expect(response.status).toBe(202)
      expect(mockRejectRelayRequest).toHaveBeenCalledTimes(1)
      expect(mockAcceptRelayRequest).not.toHaveBeenCalled()
    })

    it('accepts a non-handshake activity on the signer inbox without relay side effects', async () => {
      asSigner()
      const response = await POST(createActorInboxActivityRequest('Like'), {
        params: Promise.resolve({ username: '__instance__' })
      })

      expect(response.status).toBe(202)
      expect(mockAcceptRelayRequest).not.toHaveBeenCalled()
      expect(mockRejectRelayRequest).not.toHaveBeenCalled()
    })
  })
})

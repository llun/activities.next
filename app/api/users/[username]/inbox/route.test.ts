import { NextRequest } from 'next/server'

import { QUOTE_ACTIVITY_CONTEXT } from '@/lib/activities/quoteContext'
import {
  HANDLE_QUOTE_REQUEST_JOB_NAME,
  PROCESS_FORWARDED_ACTIVITY_JOB_NAME
} from '@/lib/jobs/names'
import { setupRecordingTracer } from '@/lib/testing/recordingTracer'
import { getHashFromString } from '@/lib/utils/getHashFromString'

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
  let harness: ReturnType<typeof setupRecordingTracer>

  beforeEach(() => {
    harness = setupRecordingTracer()
    vi.clearAllMocks()
    mockForwarded = false
    mockPublish.mockReset()
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

  describe('forwarded activity handling', () => {
    const author = 'https://writing.example/users/ninetiger'

    it('routes a forwarded Create to the forwarded-activity job', async () => {
      mockCanFederateWithDomain.mockResolvedValue(true)
      mockForwarded = true
      const activityId = `${author}/statuses/1/activity`
      mockActivityBody = {
        id: activityId,
        type: 'Create',
        actor: author,
        object: {
          id: `${author}/statuses/1`,
          type: 'Note',
          attributedTo: author
        }
      }

      const response = await POST(
        new NextRequest('https://activities.local/api/users/llun/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(mockActivityBody)
        }),
        { params: Promise.resolve({ username: 'llun' }) }
      )

      expect(response.status).toBe(202)
      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: PROCESS_FORWARDED_ACTIVITY_JOB_NAME,
          id: getHashFromString(`${activityId}#forwarded`)
        })
      )
      expect(mockPublish.mock.calls[0][0]).not.toHaveProperty(
        'verifiedSenderActorId'
      )
    })

    it('never applies a forwarded Follow', async () => {
      mockCanFederateWithDomain.mockResolvedValue(true)
      mockForwarded = true
      mockActivityBody = {
        id: 'https://remote.test/users/mallory/activities/1',
        type: 'Follow',
        actor: 'https://remote.test/users/mallory',
        object: 'https://activities.local/users/llun'
      }

      const response = await POST(
        new NextRequest('https://activities.local/api/users/llun/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(mockActivityBody)
        }),
        { params: Promise.resolve({ username: 'llun' }) }
      )

      expect(response.status).toBe(202)
      expect(mockCreateFollower).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
    })

    it('never treats a forwarded Accept as a relay handshake', async () => {
      mockActor = {
        id: 'https://activities.local/users/__instance__',
        username: '__instance__',
        type: 'Service',
        privateKey: 'private-key'
      }
      mockForwarded = true
      mockActivityBody = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://relay.example/activities/accept',
        type: 'Accept',
        actor: 'https://relay.example/actor',
        object: 'https://activities.local/relay-follow-1'
      }

      const response = await POST(
        new NextRequest(
          'https://activities.local/api/users/__instance__/inbox',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(mockActivityBody)
          }
        ),
        { params: Promise.resolve({ username: '__instance__' }) }
      )

      expect(response.status).toBe(202)
      expect(mockAcceptRelayRequest).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
    })

    it('drops a forwarded activity from a non-federatable author domain', async () => {
      mockCanFederateWithDomain.mockResolvedValue(false)
      mockForwarded = true
      mockActivityBody = {
        id: 'https://blocked.test/activities/1',
        type: 'Create',
        actor: 'https://blocked.test/users/blocked',
        object: 'https://blocked.test/statuses/1'
      }

      const response = await POST(
        new NextRequest('https://activities.local/api/users/llun/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(mockActivityBody)
        }),
        { params: Promise.resolve({ username: 'llun' }) }
      )

      expect(response.status).toBe(202)
      expect(mockPublish).not.toHaveBeenCalled()
    })
  })
})

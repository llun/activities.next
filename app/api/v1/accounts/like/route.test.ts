import { NextRequest } from 'next/server'

import { DELETE, POST } from './route'

const mockDatabase = {
  getStatus: vi.fn(),
  createLike: vi.fn(),
  deleteLike: vi.fn()
}

const mockCurrentActor = {
  id: 'https://llun.test/users/llun'
}

const mockSendLike = vi.fn()
const mockSendUndoLike = vi.fn()
const mockLikeBlueskyPost = vi.fn()
const mockUnlikeBlueskyPost = vi.fn()

vi.mock('@/lib/activities', () => ({
  sendLike: (...args: unknown[]) => mockSendLike(...args),
  sendUndoLike: (...args: unknown[]) => mockSendUndoLike(...args)
}))

vi.mock('@/lib/services/bluesky/interactions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  likeBlueskyPost: (...args: unknown[]) => mockLikeBlueskyPost(...args),
  unlikeBlueskyPost: (...args: unknown[]) => mockUnlikeBlueskyPost(...args)
}))

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{}>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

describe('POST /api/v1/accounts/like', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 422 when the request payload fails schema validation', async () => {
    const request = new NextRequest('https://llun.test/api/v1/accounts/like', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.error).toBe('Unprocessable entity')
    expect(mockDatabase.getStatus).not.toHaveBeenCalled()
    expect(mockSendLike).not.toHaveBeenCalled()
  })

  it('returns 400 when the request payload is malformed JSON', async () => {
    const request = new NextRequest('https://llun.test/api/v1/accounts/like', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Bad Request')
    expect(mockDatabase.getStatus).not.toHaveBeenCalled()
    expect(mockSendLike).not.toHaveBeenCalled()
  })

  it('likes a Bluesky post through likeBlueskyPost without sendLike and maps errors', async () => {
    const statusId = `https://bsky.app/profile/did:plc:${'l'.repeat(24)}/post/3k`
    mockDatabase.getStatus.mockResolvedValue({
      id: statusId,
      type: 'Note',
      network: 'bluesky'
    })
    mockLikeBlueskyPost.mockResolvedValueOnce({
      actorId: mockCurrentActor.id,
      statusId,
      kind: 'like',
      uri: 'at://did:plc:me/app.bsky.feed.like/3k'
    })
    const request = new NextRequest('https://llun.test/api/v1/accounts/like', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statusId })
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'Accepted' })
    expect(mockLikeBlueskyPost).toHaveBeenCalledWith(
      mockDatabase,
      mockCurrentActor,
      statusId
    )
    expect(mockDatabase.createLike).not.toHaveBeenCalled()
    expect(mockSendLike).not.toHaveBeenCalled()

    const { BlueskyActionError } =
      await import('@/lib/services/bluesky/actionErrors')
    mockLikeBlueskyPost.mockRejectedValueOnce(
      new BlueskyActionError('Link a Bluesky account first.', 422)
    )
    const refused = await POST(
      new NextRequest('https://llun.test/api/v1/accounts/like', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusId })
      }),
      { params: Promise.resolve({}) }
    )
    expect(refused.status).toBe(422)
    expect(await refused.json()).toEqual({
      error: 'Link a Bluesky account first.'
    })
  })
})

describe('DELETE /api/v1/accounts/like', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('unlikes a Bluesky post through unlikeBlueskyPost without sendUndoLike and maps errors', async () => {
    const statusId = `https://bsky.app/profile/did:plc:${'u'.repeat(24)}/post/3k`
    mockDatabase.getStatus.mockResolvedValue({
      id: statusId,
      type: 'Note',
      network: 'bluesky'
    })
    mockUnlikeBlueskyPost.mockResolvedValueOnce(undefined)

    const response = await DELETE(
      new NextRequest('https://llun.test/api/v1/accounts/like', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusId })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'Accepted' })
    expect(mockUnlikeBlueskyPost).toHaveBeenCalledWith(
      mockDatabase,
      mockCurrentActor,
      statusId
    )
    expect(mockDatabase.deleteLike).not.toHaveBeenCalled()
    expect(mockSendUndoLike).not.toHaveBeenCalled()

    const { BlueskyLockTimeoutError } =
      await import('@/lib/services/bluesky/client')
    mockUnlikeBlueskyPost.mockRejectedValueOnce(
      new BlueskyLockTimeoutError(
        `bluesky-interaction:${mockCurrentActor.id}:${statusId}:like`
      )
    )
    const busy = await DELETE(
      new NextRequest('https://llun.test/api/v1/accounts/like', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusId })
      }),
      { params: Promise.resolve({}) }
    )
    expect(busy.status).toBe(409)
    expect(await busy.json()).toEqual({
      error:
        'Another change to this post is in progress. Try again in a moment.'
    })
  })

  it('returns 422 when the request payload fails schema validation', async () => {
    const request = new NextRequest('https://llun.test/api/v1/accounts/like', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })

    const response = await DELETE(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.error).toBe('Unprocessable entity')
    expect(mockDatabase.getStatus).not.toHaveBeenCalled()
    expect(mockSendUndoLike).not.toHaveBeenCalled()
  })

  it('returns 400 when the request payload is malformed JSON', async () => {
    const request = new NextRequest('https://llun.test/api/v1/accounts/like', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: '{'
    })

    const response = await DELETE(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Bad Request')
    expect(mockDatabase.getStatus).not.toHaveBeenCalled()
    expect(mockSendUndoLike).not.toHaveBeenCalled()
  })
})

describe('like and unlike of an existing status', () => {
  const status = {
    id: 'https://remote.test/users/alice/statuses/1',
    actorId: 'https://remote.test/users/alice'
  }
  const context = { params: Promise.resolve({}) }
  const jsonRequest = (method: 'POST' | 'DELETE', body: unknown) =>
    new NextRequest('https://llun.test/api/v1/accounts/like', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getStatus.mockResolvedValue(status)
    mockDatabase.createLike.mockResolvedValue(true)
    mockDatabase.deleteLike.mockResolvedValue(true)
  })

  it('POST stores the like, then federates it to the status author', async () => {
    const response = await POST(
      jsonRequest('POST', { statusId: status.id }),
      context
    )

    // The route answers HTTP 200 carrying the Accepted body.
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'Accepted' })
    expect(mockDatabase.getStatus).toHaveBeenCalledWith({
      statusId: status.id,
      withReplies: false
    })
    expect(mockDatabase.createLike).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      statusId: status.id
    })
    expect(mockSendLike).toHaveBeenCalledWith({
      currentActor: mockCurrentActor,
      status
    })
    expect(mockDatabase.deleteLike).not.toHaveBeenCalled()
  })

  it('DELETE removes the like, then federates an Undo', async () => {
    const response = await DELETE(
      jsonRequest('DELETE', { statusId: status.id }),
      context
    )

    // The route answers HTTP 200 carrying the Accepted body.
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'Accepted' })
    expect(mockDatabase.deleteLike).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      statusId: status.id
    })
    expect(mockSendUndoLike).toHaveBeenCalledWith({
      currentActor: mockCurrentActor,
      status
    })
    expect(mockDatabase.createLike).not.toHaveBeenCalled()
  })

  it.each([
    { method: 'POST' as const, handler: POST },
    { method: 'DELETE' as const, handler: DELETE }
  ])(
    '$method answers 404 and neither writes nor federates when the status does not exist',
    async ({ method, handler }) => {
      mockDatabase.getStatus.mockResolvedValue(null)

      const response = await handler(
        jsonRequest(method, { statusId: 'missing' }),
        context
      )

      expect(response.status).toBe(404)
      expect(mockDatabase.createLike).not.toHaveBeenCalled()
      expect(mockDatabase.deleteLike).not.toHaveBeenCalled()
      expect(mockSendLike).not.toHaveBeenCalled()
      expect(mockSendUndoLike).not.toHaveBeenCalled()
    }
  )

  it('POST of a status already liked stores nothing new and sends no second Like', async () => {
    mockDatabase.createLike.mockResolvedValue(false)

    const response = await POST(
      jsonRequest('POST', { statusId: status.id }),
      context
    )

    expect(response.status).toBe(200)
    expect(mockSendLike).not.toHaveBeenCalled()
  })

  it('DELETE of a status not liked sends no Undo', async () => {
    mockDatabase.deleteLike.mockResolvedValue(false)
    const response = await DELETE(
      jsonRequest('DELETE', { statusId: status.id }),
      context
    )

    expect(response.status).toBe(200)
    expect(mockSendUndoLike).not.toHaveBeenCalled()
  })

  it('does not federate a like whose local write failed', async () => {
    mockDatabase.createLike.mockRejectedValueOnce(new Error('db down'))

    await expect(
      POST(jsonRequest('POST', { statusId: status.id }), context)
    ).rejects.toThrow('db down')
    expect(mockSendLike).not.toHaveBeenCalled()
  })
})

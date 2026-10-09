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

vi.mock('@/lib/activities', () => ({
  sendLike: (...args: unknown[]) => mockSendLike(...args),
  sendUndoLike: (...args: unknown[]) => mockSendUndoLike(...args)
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
})

describe('DELETE /api/v1/accounts/like', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('does not federate a like whose local write failed', async () => {
    mockDatabase.createLike.mockRejectedValueOnce(new Error('db down'))

    await expect(
      POST(jsonRequest('POST', { statusId: status.id }), context)
    ).rejects.toThrow('db down')
    expect(mockSendLike).not.toHaveBeenCalled()
  })
})

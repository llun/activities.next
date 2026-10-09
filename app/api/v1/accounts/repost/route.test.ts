import { NextRequest } from 'next/server'

import { DELETE, POST } from './route'

const mockDatabase = {}

const mockCurrentActor = {
  id: 'https://llun.test/users/llun'
}

const mockUserAnnounce = vi.fn()
const mockUserUndoAnnounce = vi.fn()

vi.mock('@/lib/actions/announce', () => ({
  userAnnounce: (...args: unknown[]) => mockUserAnnounce(...args)
}))

vi.mock('@/lib/actions/undoAnnounce', () => ({
  userUndoAnnounce: (...args: unknown[]) => mockUserUndoAnnounce(...args)
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

describe('POST /api/v1/accounts/repost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when the request payload is malformed JSON', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v1/accounts/repost',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{'
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Bad Request')
    expect(mockUserAnnounce).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/accounts/repost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when the request payload is malformed JSON', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v1/accounts/repost',
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: '{'
      }
    )

    const response = await DELETE(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Bad Request')
    expect(mockUserUndoAnnounce).not.toHaveBeenCalled()
  })
})

describe.each([
  {
    method: 'POST' as const,
    handler: POST,
    action: () => mockUserAnnounce,
    other: () => mockUserUndoAnnounce
  },
  {
    method: 'DELETE' as const,
    handler: DELETE,
    action: () => mockUserUndoAnnounce,
    other: () => mockUserAnnounce
  }
])('$method /api/v1/accounts/repost', ({ method, handler, action, other }) => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const jsonRequest = (body: unknown) =>
    new NextRequest('https://llun.test/api/v1/accounts/repost', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  const context = { params: Promise.resolve({}) }

  it('runs the action for the signed-in actor and returns the resulting status id', async () => {
    action().mockResolvedValue({
      id: 'https://llun.test/users/llun/statuses/boost-1'
    })

    const response = await handler(
      jsonRequest({ statusId: 'status-1' }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      statusId: 'https://llun.test/users/llun/statuses/boost-1'
    })
    expect(action()).toHaveBeenCalledWith({
      currentActor: mockCurrentActor,
      statusId: 'status-1',
      database: mockDatabase
    })
    expect(other()).not.toHaveBeenCalled()
  })

  it.each([
    { description: 'a missing statusId', body: {} },
    { description: 'a non-string statusId', body: { statusId: 5 } }
  ])(
    'answers 422 without running the action for $description',
    async ({ body }) => {
      const response = await handler(jsonRequest(body), context)

      expect(response.status).toBe(422)
      expect(action()).not.toHaveBeenCalled()
    }
  )

  it('answers 422 when the action cannot be performed on that status', async () => {
    action().mockResolvedValue(null)

    const response = await handler(
      jsonRequest({ statusId: 'unknown-status' }),
      context
    )

    expect(response.status).toBe(422)
  })
})

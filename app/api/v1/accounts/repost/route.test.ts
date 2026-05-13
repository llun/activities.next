import { NextRequest } from 'next/server'

import { DELETE, POST } from './route'

const mockDatabase = {}

const mockCurrentActor = {
  id: 'https://llun.test/users/llun'
}

const mockUserAnnounce = jest.fn()
const mockUserUndoAnnounce = jest.fn()

jest.mock('@/lib/actions/announce', () => ({
  userAnnounce: (...args: unknown[]) => mockUserAnnounce(...args)
}))

jest.mock('@/lib/actions/undoAnnounce', () => ({
  userUndoAnnounce: (...args: unknown[]) => mockUserUndoAnnounce(...args)
}))

jest.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
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
    jest.clearAllMocks()
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
    expect(data.status).toBe('Bad Request')
    expect(mockUserAnnounce).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/accounts/repost', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
    expect(data.status).toBe('Bad Request')
    expect(mockUserUndoAnnounce).not.toHaveBeenCalled()
  })
})

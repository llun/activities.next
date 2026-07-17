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

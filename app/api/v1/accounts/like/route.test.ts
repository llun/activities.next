import { NextRequest } from 'next/server'

import { DELETE, POST } from './route'

const mockDatabase = {
  getStatus: jest.fn(),
  createLike: jest.fn(),
  deleteLike: jest.fn()
}

const mockCurrentActor = {
  id: 'https://llun.test/users/llun'
}

const mockSendLike = jest.fn()
const mockSendUndoLike = jest.fn()

jest.mock('@/lib/activities', () => ({
  sendLike: (...args: unknown[]) => mockSendLike(...args),
  sendUndoLike: (...args: unknown[]) => mockSendUndoLike(...args)
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

describe('POST /api/v1/accounts/like', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
    expect(data.status).toBe('Unprocessable entity')
    expect(mockDatabase.getStatus).not.toHaveBeenCalled()
    expect(mockSendLike).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/accounts/like', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
    expect(data.status).toBe('Unprocessable entity')
    expect(mockDatabase.getStatus).not.toHaveBeenCalled()
    expect(mockSendUndoLike).not.toHaveBeenCalled()
  })
})

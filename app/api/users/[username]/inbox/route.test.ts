import { NextRequest } from 'next/server'

import { POST } from './route'

const mockCanFederateWithDomain = jest.fn()
const mockCreateFollower = jest.fn()
const mockVerifyAllows = jest.fn()
const mockDatabase = {}

jest.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
}))

jest.mock('@/lib/services/guards/ActivityPubVerifyGuard', () => ({
  ActivityPubVerifySenderGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          params: Promise<{ username: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    async (
      req: NextRequest,
      context: { params: Promise<{ username: string }> }
    ) => {
      if (!(await mockVerifyAllows(req, context))) {
        return Response.json({ status: 'Bad Request' }, { status: 400 })
      }

      return handle(req, {
        database: mockDatabase,
        params: context.params
      })
    }
}))

jest.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
  OnlyLocalUserGuard:
    (
      handle: (
        database: typeof mockDatabase,
        actor: { id: string },
        req: NextRequest,
        query: { params: Promise<{ username: string }> }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, query: { params: Promise<{ username: string }> }) =>
      handle(
        mockDatabase,
        { id: 'https://activities.local/users/llun' },
        req,
        query
      )
}))

jest.mock('@/lib/actions/acceptFollowRequest', () => ({
  acceptFollowRequest: jest.fn()
}))

jest.mock('@/lib/actions/createFollower', () => ({
  createFollower: (...params: unknown[]) => mockCreateFollower(...params)
}))

jest.mock('@/lib/actions/like', () => ({
  likeRequest: jest.fn()
}))

jest.mock('@/lib/actions/rejectFollowRequest', () => ({
  rejectFollowRequest: jest.fn()
}))

jest.mock('@/lib/actions/undoFollowRequest', () => ({
  undoFollowRequest: jest.fn()
}))

const createFollowRequest = () =>
  new NextRequest('https://activities.local/api/users/llun/inbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'https://remote.test/users/alice/follows/1',
      type: 'Follow',
      actor: 'https://remote.test/users/alice',
      object: 'https://activities.local/users/llun'
    })
  })

describe('POST /api/users/[username]/inbox', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifyAllows.mockResolvedValue(true)
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockCreateFollower.mockResolvedValue({
      object: 'https://activities.local/users/llun'
    })
  })

  it('rejects requests before processing when sender verification fails', async () => {
    mockVerifyAllows.mockResolvedValue(false)

    const response = await POST(createFollowRequest(), {
      params: Promise.resolve({ username: 'llun' })
    })

    expect(response.status).toBe(400)
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
})

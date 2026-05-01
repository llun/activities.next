import { NextRequest } from 'next/server'

import { FollowStatus } from '@/lib/types/domain/follow'

import { DELETE, POST } from './route'

const mockFollow = jest.fn()
const mockUnfollow = jest.fn()
const mockCanFederateWithDomain = jest.fn()
const mockCurrentActor = {
  id: 'https://llun.test/users/llun',
  domain: 'llun.test'
}
const mockSigningActor = {
  id: 'https://llun.test/users/__instance__',
  type: 'Service',
  username: '__instance__',
  domain: 'llun.test',
  privateKey: 'instance-key'
}
const mockDatabase = {
  getAcceptedOrRequestedFollow: jest.fn(),
  updateFollowStatus: jest.fn(),
  getFederationSigningActor: jest.fn()
}

jest.mock('@/lib/activities', () => ({
  follow: (...params: unknown[]) => mockFollow(...params),
  unfollow: (...params: unknown[]) => mockUnfollow(...params)
}))

jest.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: jest.fn()
}))

jest.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
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

describe('DELETE /api/v1/accounts/follow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
      id: 'follow-1',
      actorId: mockCurrentActor.id,
      targetActorId: 'https://blocked.test/users/alice'
    })
    mockDatabase.updateFollowStatus.mockResolvedValue(undefined)
    mockDatabase.getFederationSigningActor.mockResolvedValue(mockSigningActor)
  })

  const createRequest = () =>
    new NextRequest('https://llun.test/api/v1/accounts/follow', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'https://blocked.test/users/alice' })
    })

  const createInvalidJsonRequest = (method: 'POST' | 'DELETE') =>
    new NextRequest('https://llun.test/api/v1/accounts/follow', {
      method,
      headers: { 'content-type': 'application/json' },
      body: '{'
    })

  it('returns 400 for invalid JSON on follow', async () => {
    const response = await POST(createInvalidJsonRequest('POST'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid JSON body'
    })
    expect(mockFollow).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON on unfollow', async () => {
    const response = await DELETE(createInvalidJsonRequest('DELETE'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid JSON body'
    })
    expect(mockUnfollow).not.toHaveBeenCalled()
  })

  it('updates local state without sending Undo to blocked domains', async () => {
    mockCanFederateWithDomain.mockResolvedValue(false)

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(202)
    expect(mockUnfollow).not.toHaveBeenCalled()
    expect(mockDatabase.updateFollowStatus).toHaveBeenCalledWith({
      followId: 'follow-1',
      status: FollowStatus.enum.Undo
    })
  })

  it('sends Undo when the target domain is allowed', async () => {
    mockCanFederateWithDomain.mockResolvedValue(true)

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(202)
    expect(mockUnfollow).toHaveBeenCalledWith(
      mockCurrentActor,
      {
        id: 'follow-1',
        actorId: mockCurrentActor.id,
        targetActorId: 'https://blocked.test/users/alice'
      },
      mockSigningActor
    )
  })
})

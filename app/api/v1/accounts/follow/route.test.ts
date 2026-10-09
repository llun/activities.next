import { NextRequest } from 'next/server'

import { getActorPerson } from '@/lib/activities/getActorPerson'
import { FollowStatus } from '@/lib/types/domain/follow'

import { DELETE, GET, POST } from './route'

const mockFollow = vi.fn()
const mockUnfollow = vi.fn()
const mockCanFederateWithDomain = vi.fn()
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
  getAcceptedOrRequestedFollow: vi.fn(),
  createFollow: vi.fn(),
  updateFollowStatus: vi.fn(),
  getFederationSigningActor: vi.fn()
}

vi.mock('@/lib/activities', () => ({
  follow: (...params: unknown[]) => mockFollow(...params),
  unfollow: (...params: unknown[]) => mockUnfollow(...params)
}))

vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: vi.fn()
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
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

const TARGET = 'https://remote.test/users/alice'

const jsonRequest = (method: 'POST' | 'DELETE', body: unknown) =>
  new NextRequest('https://llun.test/api/v1/accounts/follow', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
const emptyContext = { params: Promise.resolve({}) }

describe('DELETE /api/v1/accounts/follow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('answers 422 when the body has no target', async () => {
    const response = await DELETE(jsonRequest('DELETE', {}), emptyContext)

    expect(response.status).toBe(422)
    expect(mockDatabase.getAcceptedOrRequestedFollow).not.toHaveBeenCalled()
  })

  it('answers 404 and sends nothing when there is no follow to undo', async () => {
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)

    const response = await DELETE(
      jsonRequest('DELETE', { target: TARGET }),
      emptyContext
    )

    expect(response.status).toBe(404)
    expect(mockUnfollow).not.toHaveBeenCalled()
    expect(mockDatabase.updateFollowStatus).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/accounts/follow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('answers 404 when targetActorId is not provided', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/accounts/follow'),
      emptyContext
    )

    expect(response.status).toBe(404)
    expect(mockDatabase.getAcceptedOrRequestedFollow).not.toHaveBeenCalled()
  })

  it('looks up the follow between the signed-in actor and the target', async () => {
    const follow = {
      id: 'follow-1',
      actorId: mockCurrentActor.id,
      targetActorId: TARGET,
      status: FollowStatus.enum.Requested
    }
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(follow)

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v1/accounts/follow?targetActorId=${encodeURIComponent(TARGET)}`
      ),
      emptyContext
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ follow })
    expect(mockDatabase.getAcceptedOrRequestedFollow).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      targetActorId: TARGET
    })
  })
})

describe('POST /api/v1/accounts/follow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockDatabase.getFederationSigningActor.mockResolvedValue(mockSigningActor)
    vi.mocked(getActorPerson).mockResolvedValue({ id: TARGET } as never)
    mockDatabase.createFollow.mockResolvedValue({ id: 'follow-new' })
  })

  it('answers 422 when the body has no target', async () => {
    const response = await POST(jsonRequest('POST', {}), emptyContext)

    expect(response.status).toBe(422)
    expect(mockDatabase.createFollow).not.toHaveBeenCalled()
    expect(mockFollow).not.toHaveBeenCalled()
  })

  it('refuses to follow an account on a domain federation policy blocks', async () => {
    mockCanFederateWithDomain.mockResolvedValue(false)

    const response = await POST(
      jsonRequest('POST', { target: TARGET }),
      emptyContext
    )

    expect(response.status).toBe(403)
    expect(mockCanFederateWithDomain).toHaveBeenCalledWith(mockDatabase, TARGET)
    expect(getActorPerson).not.toHaveBeenCalled()
    expect(mockDatabase.createFollow).not.toHaveBeenCalled()
    expect(mockFollow).not.toHaveBeenCalled()
  })

  it('answers 404 without recording a follow when the remote actor cannot be resolved', async () => {
    vi.mocked(getActorPerson).mockResolvedValue(undefined as never)

    const response = await POST(
      jsonRequest('POST', { target: TARGET }),
      emptyContext
    )

    expect(response.status).toBe(404)
    expect(mockDatabase.createFollow).not.toHaveBeenCalled()
    expect(mockFollow).not.toHaveBeenCalled()
  })

  it('records a Requested follow and sends the Follow activity signed by the instance actor', async () => {
    const response = await POST(
      jsonRequest('POST', { target: TARGET }),
      emptyContext
    )

    expect(response.status).toBe(202)
    expect(getActorPerson).toHaveBeenCalledWith({
      actorId: TARGET,
      signingActor: mockSigningActor
    })
    expect(mockDatabase.createFollow).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      targetActorId: TARGET,
      status: FollowStatus.enum.Requested,
      inbox: `${mockCurrentActor.id}/inbox`,
      sharedInbox: 'https://llun.test/inbox'
    })
    expect(mockFollow).toHaveBeenCalledWith(
      'follow-new',
      mockCurrentActor,
      TARGET,
      mockSigningActor
    )
  })
})

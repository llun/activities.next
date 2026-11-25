import { NextRequest } from 'next/server'

import {
  BlueskyLinkError,
  getBlueskyAccountState,
  updateBlueskyCrosspostDefault
} from '@/lib/services/bluesky/account'

import { DELETE, PATCH } from './route'

const currentActor = { id: 'actor-a', domain: 'social.example' }
const database = {
  getBlueskyAccount: vi.fn(),
  deleteBlueskyAccount: vi.fn()
}
const guardCalls: string[] = []

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (handle: (req: NextRequest, context: unknown) => unknown) =>
    (req: NextRequest, context: object) => {
      guardCalls.push('session')
      return handle(req, { ...context, currentActor, database })
    }
}))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getConfig: () => ({ host: 'social.example' })
}))
vi.mock('@/lib/services/bluesky/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/bluesky/account')>()),
  getBlueskyAccountState: vi.fn(),
  updateBlueskyCrosspostDefault: vi.fn()
}))

const call = (body: unknown) =>
  PATCH(
    new NextRequest('https://social.example/api/v1/bluesky/account', {
      method: 'PATCH',
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({}) }
  )

describe('PATCH /api/v1/bluesky/account', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    guardCalls.length = 0
  })

  it('saves the cross-post default and answers the account', async () => {
    vi.mocked(getBlueskyAccountState).mockResolvedValue({
      oauthAvailable: true,
      account: null,
      instanceHandle: null
    })

    const response = await call({ crosspostByDefault: false })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      oauthAvailable: true,
      account: null,
      instanceHandle: null
    })
    expect(updateBlueskyCrosspostDefault).toHaveBeenCalledWith(
      database,
      currentActor,
      false
    )
    expect(guardCalls).toEqual(['session'])
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'PATCH'
    )
  })

  it('refuses a body that is not a boolean choice', async () => {
    const response = await call({ crosspostByDefault: 'no' })

    expect(response.status).toBe(400)
    expect(updateBlueskyCrosspostDefault).not.toHaveBeenCalled()
  })

  it('answers 422 { error } without a linked account', async () => {
    vi.mocked(updateBlueskyCrosspostDefault).mockRejectedValue(
      new BlueskyLinkError('Link a Bluesky account first.')
    )

    const response = await call({ crosspostByDefault: true })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'Link a Bluesky account first.'
    })
  })
})

describe('DELETE /api/v1/bluesky/account', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('refuses to unlink an account hosted on this server', async () => {
    database.getBlueskyAccount.mockResolvedValue({
      actorId: currentActor.id,
      did: 'did:plc:hosted',
      authType: 'hosted'
    })

    const response = await DELETE(
      new NextRequest('https://social.example/api/v1/bluesky/account', {
        method: 'DELETE'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error:
        'Your Bluesky account is hosted on this server. Manage it under “Host my Bluesky account here”.'
    })
    expect(database.deleteBlueskyAccount).not.toHaveBeenCalled()
  })
})

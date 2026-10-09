import { NextRequest } from 'next/server'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { logger } from '@/lib/utils/logger'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const { database, instance } = getTestSQLDatabaseWithInstance()
vi.mock('@/lib/database', () => ({
  getDatabase: () => database,
  getKnex: () => instance
}))

const mockCookieSet = vi.fn()
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: mockCookieSet }))
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: []
  })
}))

const SESSION_TOKEN = 'session-token-1'

const buildRequest = (
  body: unknown,
  headers: Record<string, string> = { origin: 'https://llun.test' }
) =>
  new NextRequest('https://llun.test/api/v1/actors/switch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

const post = (req: NextRequest) => POST(req, { params: Promise.resolve({}) })

describe('POST /api/v1/actors/switch', () => {
  let secondActorId: string
  let deletingActorId: string

  const sessionActorId = async () =>
    (await instance('sessions').where('token', SESSION_TOKEN).first())?.actorId

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const account = await database.getAccountFromEmail({
      email: seedActor1.email
    })
    if (!account) throw new Error('Account not found')
    secondActorId = await database.createActorForAccount({
      accountId: account.id,
      username: 'second',
      domain: 'llun.test',
      publicKey: 'second-public-key',
      privateKey: 'second-private-key'
    })
    deletingActorId = await database.createActorForAccount({
      accountId: account.id,
      username: 'going-away',
      domain: 'llun.test',
      publicKey: 'going-away-public-key',
      privateKey: 'going-away-private-key'
    })
    await database.scheduleActorDeletion({
      actorId: deletingActorId,
      scheduledAt: new Date(Date.now() + 86_400_000)
    })
    await instance('sessions').insert({
      id: 'session-1',
      accountId: account.id,
      token: SESSION_TOKEN,
      expireAt: new Date(Date.now() + 86_400_000),
      actorId: ACTOR1_ID
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email },
      session: { token: SESSION_TOKEN }
    })
    await instance('sessions')
      .where('token', SESSION_TOKEN)
      .update({ actorId: ACTOR1_ID })
  })

  it('switches to an owned actor: updates the session actor, sets the cookie and returns the actor summary', async () => {
    const response = await post(buildRequest({ actorId: secondActorId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: secondActorId,
      username: 'second',
      domain: 'llun.test'
    })
    await expect(sessionActorId()).resolves.toBe(secondActorId)
    expect(mockCookieSet).toHaveBeenCalledWith(
      'activities.actor-id',
      secondActorId,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30
      })
    )
  })

  it('does not mark the cookie secure on a plain http request', async () => {
    const req = new NextRequest('http://llun.test/api/v1/actors/switch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: JSON.stringify({ actorId: secondActorId })
    })

    const response = await post(req)

    expect(response.status).toBe(200)
    expect(mockCookieSet).toHaveBeenCalledWith(
      'activities.actor-id',
      secondActorId,
      expect.objectContaining({ secure: false })
    )
  })

  it('returns 401 when there is no session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await post(buildRequest({ actorId: secondActorId }))

    expect(response.status).toBe(401)
    await expect(sessionActorId()).resolves.toBe(ACTOR1_ID)
    expect(mockCookieSet).not.toHaveBeenCalled()
  })

  it('returns 401 when the session email has no account', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'nobody@llun.test' },
      session: { token: SESSION_TOKEN }
    })

    const response = await post(buildRequest({ actorId: secondActorId }))

    expect(response.status).toBe(401)
    expect(mockCookieSet).not.toHaveBeenCalled()
  })

  it.each([
    ['no Origin or Referer header', {}],
    ['a cross-site Origin', { origin: 'https://evil.test' }]
  ])(
    'returns 403 and changes nothing with %s (CSRF)',
    async (_name, headers) => {
      const response = await post(
        buildRequest({ actorId: secondActorId }, headers)
      )

      expect(response.status).toBe(403)
      await expect(sessionActorId()).resolves.toBe(ACTOR1_ID)
      expect(mockCookieSet).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['a body that is not JSON', 'not json'],
    ['a missing actorId', {}],
    ['an empty actorId', { actorId: '' }],
    ['a non-string actorId', { actorId: 42 }]
  ])('returns 400 for %s', async (_name, body) => {
    const response = await post(buildRequest(body))

    expect(response.status).toBe(400)
    await expect(sessionActorId()).resolves.toBe(ACTOR1_ID)
  })

  it('returns 404 and does not switch to an actor owned by another account', async () => {
    const response = await post(buildRequest({ actorId: ACTOR2_ID }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Actor not found or not owned by account'
    })
    await expect(sessionActorId()).resolves.toBe(ACTOR1_ID)
    expect(mockCookieSet).not.toHaveBeenCalled()
  })

  it('returns 400 and does not switch to an actor pending deletion', async () => {
    const response = await post(buildRequest({ actorId: deletingActorId }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error:
        'Cannot switch to an actor that is pending deletion or being deleted'
    })
    await expect(sessionActorId()).resolves.toBe(ACTOR1_ID)
    expect(mockCookieSet).not.toHaveBeenCalled()
  })

  it('still sets the cookie when the better-auth session carries no token', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const response = await post(buildRequest({ actorId: secondActorId }))

    expect(response.status).toBe(200)
    await expect(sessionActorId()).resolves.toBe(ACTOR1_ID)
    expect(mockCookieSet).toHaveBeenCalledWith(
      'activities.actor-id',
      secondActorId,
      expect.any(Object)
    )
  })

  it('returns 500 without setting the cookie when the session row cannot be updated', async () => {
    const errorSpy = vi.spyOn(logger, 'error')
    await instance.schema.renameTable('sessions', 'sessions_renamed')
    try {
      const response = await post(buildRequest({ actorId: secondActorId }))

      expect(response.status).toBe(500)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to update session actorId'
        })
      )
      expect(mockCookieSet).not.toHaveBeenCalled()
    } finally {
      await instance.schema.renameTable('sessions_renamed', 'sessions')
    }
  })
})

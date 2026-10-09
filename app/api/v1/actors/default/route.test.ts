import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const database = getTestSQLDatabase()
vi.mock('@/lib/database', () => ({
  getDatabase: () => database
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: []
  })
}))

const buildRequest = (body: unknown) =>
  new NextRequest('https://llun.test/api/v1/actors/default', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://llun.test'
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

const post = (req: NextRequest) => POST(req, { params: Promise.resolve({}) })

describe('POST /api/v1/actors/default', () => {
  let secondActorId: string

  const defaultActorId = async () =>
    (await database.getAccountFromEmail({ email: seedActor1.email }))
      ?.defaultActorId

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
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    await database.setDefaultActor({
      accountId: (await database.getAccountFromEmail({
        email: seedActor1.email
      }))!.id,
      actorId: ACTOR1_ID
    })
  })

  it('stores an owned actor as the account default and returns its summary', async () => {
    const response = await post(buildRequest({ actorId: secondActorId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      defaultActorId: secondActorId,
      id: secondActorId,
      username: 'second',
      domain: 'llun.test'
    })
    await expect(defaultActorId()).resolves.toBe(secondActorId)
  })

  it('returns 404 and keeps the default when the actor belongs to another account', async () => {
    const response = await post(buildRequest({ actorId: ACTOR2_ID }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Actor not found or not owned by account'
    })
    await expect(defaultActorId()).resolves.toBe(ACTOR1_ID)
  })

  it.each([
    ['a body that is not JSON', 'not json'],
    ['a missing actorId', {}],
    ['an empty actorId', { actorId: '' }],
    ['a non-string actorId', { actorId: 7 }]
  ])('returns 400 for %s and keeps the default', async (_name, body) => {
    const response = await post(buildRequest(body))

    expect(response.status).toBe(400)
    await expect(defaultActorId()).resolves.toBe(ACTOR1_ID)
  })
})

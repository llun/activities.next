import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({ where: () => ({ first: () => null }) })
}))

vi.mock('next/headers', () => ({
  cookies: vi
    .fn()
    .mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) })
}))

vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const signIn = (email: string | null) =>
  mockGetServerSession.mockResolvedValue(email ? { user: { email } } : null)

const call = (accountId: string, query = '') =>
  GET(
    new NextRequest(
      `https://llun.test/api/v1/accounts/${urlToId(accountId)}/gallery/life-list${query}`,
      { method: 'GET' }
    ),
    { params: Promise.resolve({ id: urlToId(accountId) }) }
  )

describe('GET /api/v1/accounts/:id/gallery/life-list', () => {
  const { database, prepare } = getTestDatabaseWithInstance()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    await seedGalleryRouteFixtures(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    signIn(null)
  })

  it.each([
    ['a missing actor', 'https://llun.test/users/nobody'],
    ['a remote actor', EXTERNAL_ACTOR1]
  ])('answers 404 for %s', async (_, accountId) => {
    const response = await call(accountId)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not Found' })
  })

  const setPublic = (lifeListPublic: boolean) =>
    database.updateGallerySettings({ actorId: ACTOR1_ID, lifeListPublic })

  it('answers 404 to a stranger and a logged-out caller while it is private', async () => {
    await setPublic(false)

    expect((await call(ACTOR1_ID)).status).toBe(404)
    signIn(seedActor2.email)
    expect((await call(ACTOR1_ID)).status).toBe(404)
  })

  it('answers the owner while it is private, landscapes excluded', async () => {
    await setPublic(false)
    signIn(seedActor1.email)

    const response = await call(ACTOR1_ID)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.entries.map((entry: { name: string }) => entry.name)).toEqual(
      expect.arrayContaining(['Kingfisher', 'Red Fox', 'Grey Heron'])
    )
    expect(
      data.entries.map((entry: { name: string }) => entry.name)
    ).not.toContain('Lakes')
  })

  it('answers a stranger from the visible posts once it is public', async () => {
    await setPublic(true)
    signIn(seedActor2.email)

    const response = await call(ACTOR1_ID)

    expect(response.status).toBe(200)
    const names = (await response.json()).entries.map(
      (entry: { name: string }) => entry.name
    )
    expect(names).toContain('Kingfisher')
    expect(names).not.toContain('Grey Heron')
  })
})

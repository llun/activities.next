import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
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
      `https://llun.test/api/v1/accounts/${urlToId(accountId)}/gallery/subjects${query}`,
      { method: 'GET' }
    ),
    { params: Promise.resolve({ id: urlToId(accountId) }) }
  )

describe('GET /api/v1/accounts/:id/gallery/subjects', () => {
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

  const subjectNames = async (response: Response) => {
    const data = await response.json()
    return data.groups.flatMap((group: { subjects: { name: string }[] }) =>
      group.subjects.map((subject) => subject.name)
    )
  }

  it('groups the public subjects for a logged-out caller', async () => {
    const response = await call(ACTOR1_ID)

    expect(response.status).toBe(200)
    const names = await subjectNames(response)
    expect(names).toEqual(
      expect.arrayContaining(['Kingfisher', 'Red Fox', 'Lakes'])
    )
    expect(names).not.toContain('Grey Heron')
  })

  it('adds followers-only subjects for a follower and the owner', async () => {
    signIn(seedActor3.email)
    expect(await subjectNames(await call(ACTOR1_ID))).toContain('Grey Heron')

    signIn(seedActor1.email)
    expect(await subjectNames(await call(ACTOR1_ID))).toContain('Grey Heron')
  })

  it('withholds followers-only subjects from a stranger', async () => {
    signIn(seedActor2.email)

    expect(await subjectNames(await call(ACTOR1_ID))).not.toContain(
      'Grey Heron'
    )
  })
})

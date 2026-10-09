import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { OPTIONS, PATCH } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('PATCH /api/v2/filters/:id', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  // Rails `resources` maps update to both PATCH and PUT, so Mastodon clients may
  // send either; a PATCH must update the filter instead of answering 405.
  it('updates the filter when the request is sent as PATCH', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'patch-old',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'patch-old', wholeWord: false }]
    })

    const response = await PATCH(
      new NextRequest(`https://llun.test/api/v2/filters/${filter.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test',
          Referer: 'https://llun.test/'
        },
        body: JSON.stringify({
          title: 'patch-new',
          context: ['home', 'public'],
          filter_action: 'hide'
        })
      }),
      { params: Promise.resolve({ id: filter.id }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: filter.id,
      title: 'patch-new',
      context: ['home', 'public'],
      filter_action: 'hide'
    })
    expect(
      await database.getFilter({ actorId: ACTOR1_ID, id: filter.id })
    ).toMatchObject({
      title: 'patch-new',
      context: ['home', 'public'],
      filterAction: 'hide'
    })
  })

  it('advertises PATCH in the OPTIONS Access-Control-Allow-Methods header', async () => {
    const response = await OPTIONS(
      new NextRequest('https://llun.test/api/v2/filters/filter-1', {
        method: 'OPTIONS',
        headers: { origin: 'https://llun.test' }
      })
    )

    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'PATCH'
    )
  })
})

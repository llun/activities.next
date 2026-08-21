import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
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

describe('GET /api/v1/statuses/[id]/favourited_by', () => {
  const database = getTestSQLDatabase()
  const statusId = `${ACTOR1_ID}/statuses/favourited-by-test`

  // publicIds are minted at insert and random per run, so read the emitted id
  // back off the stored row rather than hard-coding one.
  const emittedActorId = async (actorId: string) => {
    const publicIds = await database.getActorPublicIds({ actorIds: [actorId] })
    return publicIds.get(actorId) ?? urlToId(actorId)
  }

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database

    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Status for favourited_by test',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createLike({ statusId, actorId: ACTOR2_ID })
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
  })

  it('returns the favouriting accounts with their emitted ids', async () => {
    const req = new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/favourited_by`
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: urlToId(statusId) })
    })

    expect(response.status).toBe(200)
    const accounts = (await response.json()) as { id: string }[]
    expect(accounts.map((account) => account.id)).toEqual([
      await emittedActorId(ACTOR2_ID)
    ])
  })

  it('resolves favouriting accounts whose url is a profile url rather than the actor uri', async () => {
    // The account entity id is a publicId that cannot be decoded back to an
    // actor URI, so an actor serving `/@name` as its `url` must still be
    // matched — through `uri` — or the favouriter silently disappears.
    const storedAccounts = await database.getMastodonActorsFromIds({
      ids: [ACTOR2_ID]
    })
    vi.spyOn(database, 'getMastodonActorsFromIds').mockResolvedValueOnce(
      storedAccounts.map((account) => ({
        ...account,
        url: 'https://llun.test/@test2'
      }))
    )

    const req = new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/favourited_by`
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: urlToId(statusId) })
    })

    expect(response.status).toBe(200)
    const accounts = (await response.json()) as { id: string }[]
    expect(accounts.map((account) => account.id)).toEqual([
      await emittedActorId(ACTOR2_ID)
    ])
  })
})

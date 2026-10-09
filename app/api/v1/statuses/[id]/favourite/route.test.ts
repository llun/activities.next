import { NextRequest } from 'next/server'

import { sendLike } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

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

vi.mock('@/lib/activities', () => ({
  sendLike: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const favourite = (statusId: string) =>
  POST(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/favourite`,
      { method: 'POST', headers: { Origin: 'https://llun.test' } }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

describe('POST /api/v1/statuses/[id]/favourite', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  // The signed-in actor (actor1) favourites a status by actor2.
  const seedNote = async (suffix: string, to: string[]) => {
    const statusId = `${ACTOR2_ID}/statuses/favourite-${suffix}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'like me',
      to,
      cc: []
    })
    return statusId
  }

  it('records the like, federates it and returns the status as favourited', async () => {
    const statusId = await seedNote('readable', [ACTIVITY_STREAM_PUBLIC])

    const response = await favourite(statusId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      favourited: true,
      favourites_count: 1
    })
    await expect(
      database.isActorLikedStatus({ actorId: ACTOR1_ID, statusId })
    ).resolves.toBeTrue()
    expect(sendLike).toHaveBeenCalledTimes(1)
  })

  it('is idempotent and does not federate a second Like activity', async () => {
    const statusId = await seedNote('twice', [ACTIVITY_STREAM_PUBLIC])

    await favourite(statusId)
    const response = await favourite(statusId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      favourited: true,
      favourites_count: 1
    })
    expect(sendLike).toHaveBeenCalledTimes(1)
  })

  it('returns 404 and records nothing for a status the actor cannot read', async () => {
    const statusId = await seedNote('private', [])

    const response = await favourite(statusId)

    expect(response.status).toBe(404)
    await expect(
      database.isActorLikedStatus({ actorId: ACTOR1_ID, statusId })
    ).resolves.toBeFalse()
    expect(sendLike).not.toHaveBeenCalled()
  })

  it('returns 404 for a status that does not exist', async () => {
    const response = await favourite(`${ACTOR2_ID}/statuses/favourite-missing`)

    expect(response.status).toBe(404)
    expect(sendLike).not.toHaveBeenCalled()
  })
})

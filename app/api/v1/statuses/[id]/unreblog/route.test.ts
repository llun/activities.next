import { NextRequest } from 'next/server'

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

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const unreblog = (statusId: string) =>
  POST(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/unreblog`,
      { method: 'POST', headers: { Origin: 'https://llun.test' } }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

describe('POST /api/v1/statuses/[id]/unreblog', () => {
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

  // The signed-in actor (actor1) boosts a status by actor2.
  const seedBoost = async (suffix: string, to: string[]) => {
    const originalId = `${ACTOR2_ID}/statuses/unreblog-original-${suffix}`
    await database.createNote({
      id: originalId,
      url: originalId,
      actorId: ACTOR2_ID,
      text: 'boost me',
      to,
      cc: []
    })
    const announceId = `${ACTOR1_ID}/statuses/unreblog-announce-${suffix}`
    await database.createAnnounce({
      id: announceId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: originalId
    })
    return { originalId, announceId }
  }

  it('undoes the boost and returns the status', async () => {
    const { originalId, announceId } = await seedBoost('readable', [
      ACTIVITY_STREAM_PUBLIC
    ])

    const response = await unreblog(originalId)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).not.toEqual({ status: 'OK' })
    expect(body).toMatchObject({ id: expect.toBeString() })
    expect(await database.getStatus({ statusId: announceId })).toBeNull()
  })

  // The original was narrowed after the boost, so the serializer withholds
  // it. The undo itself succeeded and must be acknowledged, not reported as
  // a failure or answered with an empty body.
  it('acknowledges the undo when the boosted status is no longer readable', async () => {
    const { originalId, announceId } = await seedBoost('narrowed', [])

    const response = await unreblog(originalId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'OK' })
    expect(await database.getStatus({ statusId: announceId })).toBeNull()
  })

  it('returns 404 when the actor has no boost of a status it cannot read', async () => {
    const originalId = `${ACTOR2_ID}/statuses/unreblog-never-boosted`
    await database.createNote({
      id: originalId,
      url: originalId,
      actorId: ACTOR2_ID,
      text: 'private',
      to: [],
      cc: []
    })

    const response = await unreblog(originalId)

    expect(response.status).toBe(404)
  })
})

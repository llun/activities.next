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

const clear = () =>
  POST(
    new NextRequest('https://llun.test/api/v1/notifications/clear', {
      method: 'POST',
      headers: { Origin: 'https://llun.test' }
    }),
    { params: Promise.resolve({}) }
  )

describe('POST /api/v1/notifications/clear', () => {
  const database = getTestSQLDatabase()

  const notificationsOf = (actorId: string) =>
    database.getNotifications({
      actorId,
      limit: 5000,
      includeFiltered: true
    })

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

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    for (const n of await notificationsOf(ACTOR1_ID)) {
      await database.deleteNotification(n.id)
    }
    for (const n of await notificationsOf(ACTOR2_ID)) {
      await database.deleteNotification(n.id)
    }
  })

  it('clears every notification of the actor, filtered ones included, and answers {}', async () => {
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: 'follow',
      sourceActorId: ACTOR2_ID
    })
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: 'follow',
      sourceActorId: ACTOR2_ID,
      filtered: true
    })
    expect(await notificationsOf(ACTOR1_ID)).toHaveLength(2)

    const response = await clear()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
    expect(await notificationsOf(ACTOR1_ID)).toHaveLength(0)
  })

  it('leaves other actors notifications untouched', async () => {
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: 'follow',
      sourceActorId: ACTOR2_ID
    })
    await database.createNotification({
      actorId: ACTOR2_ID,
      type: 'follow',
      sourceActorId: ACTOR1_ID
    })

    const response = await clear()

    expect(response.status).toBe(200)
    expect(await notificationsOf(ACTOR1_ID)).toHaveLength(0)
    expect(await notificationsOf(ACTOR2_ID)).toHaveLength(1)
  })

  it('clears more notifications than fit in one 1000-row batch', async () => {
    for (let i = 0; i < 1005; i++) {
      await database.createNotification({
        actorId: ACTOR1_ID,
        type: 'follow',
        sourceActorId: ACTOR2_ID
      })
    }
    expect(await notificationsOf(ACTOR1_ID)).toHaveLength(1005)

    const response = await clear()

    expect(response.status).toBe(200)
    expect(await notificationsOf(ACTOR1_ID)).toHaveLength(0)
  }, 60_000)
})

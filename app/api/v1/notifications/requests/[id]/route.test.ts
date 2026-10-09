import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { actorPublicId, statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { NotificationType } from '@/lib/types/database/operations'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

// The OAuth guard is covered by its own tests; here the caller is always actor1.
vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          currentActor: { id: string }
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        currentActor: { id: 'https://llun.test/users/test1' },
        params: context.params
      })
}))

describe('GET /api/v1/notifications/requests/[id]', () => {
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

  beforeEach(async () => {
    for (const actorId of [ACTOR1_ID, ACTOR2_ID]) {
      const existing = await database.getNotifications({
        actorId,
        limit: 1000,
        includeFiltered: true
      })
      for (const n of existing) await database.deleteNotification(n.id)
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    mockDatabase = database
  })

  const get = (id: string) =>
    GET(
      new NextRequest(`https://llun.test/api/v1/notifications/requests/${id}`),
      { params: Promise.resolve({ id }) }
    )

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await get('anything')

    expect(response.status).toBe(500)
  })

  it('returns the request for a sender with filtered notifications', async () => {
    const statusId = `${ACTOR2_ID}/statuses/request-detail-status`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'Hello from a stranger',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    // Distinct timestamps so "latest" is well defined.
    vi.useFakeTimers({ toFake: ['Date'] })
    for (const [i, sid] of [undefined, statusId].entries()) {
      vi.setSystemTime(
        new Date('2026-03-01T00:00:00.000Z').getTime() + i * 1000
      )
      await database.createNotification({
        actorId: ACTOR1_ID,
        type: sid
          ? NotificationType.enum.mention
          : NotificationType.enum.follow,
        sourceActorId: ACTOR2_ID,
        statusId: sid,
        filtered: true
      })
    }
    const publicId = await actorPublicId(database, ACTOR2_ID)

    const response = await get(publicId)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: publicId,
      notifications_count: '2',
      account: { id: publicId },
      last_status: { id: await statusPublicId(database, statusId) }
    })
  })

  it('accepts the sender as a raw actor uri', async () => {
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: NotificationType.enum.follow,
      sourceActorId: ACTOR2_ID,
      filtered: true
    })

    const response = await get(ACTOR2_ID)

    expect(response.status).toBe(200)
  })

  it.each([
    ['has no notifications', async () => {}],
    [
      'only has visible (unfiltered) notifications',
      async () => {
        await database.createNotification({
          actorId: ACTOR1_ID,
          type: NotificationType.enum.follow,
          sourceActorId: ACTOR2_ID
        })
      }
    ],
    [
      'only filtered the request for a different recipient',
      async () => {
        await database.createNotification({
          actorId: ACTOR3_ID,
          type: NotificationType.enum.follow,
          sourceActorId: ACTOR2_ID,
          filtered: true
        })
      }
    ]
  ])('returns 404 when the sender %s', async (_, arrange) => {
    await arrange()

    const response = await get(await actorPublicId(database, ACTOR2_ID))

    expect(response.status).toBe(404)
  })

  it('returns 404 when the sender account cannot be resolved', async () => {
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: NotificationType.enum.follow,
      sourceActorId: 'https://gone.example/users/ghost',
      filtered: true
    })

    const response = await get('https://gone.example/users/ghost')

    expect(response.status).toBe(404)
  })
})

import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { actorPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { NotificationType } from '@/lib/types/database/operations'

import { POST } from './route'

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

describe('POST /api/v1/notifications/requests/[id]/dismiss', () => {
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
    mockDatabase = database
  })

  const post = (id: string) =>
    POST(
      new NextRequest(
        `https://llun.test/api/v1/notifications/requests/${id}/dismiss`,
        { method: 'POST' }
      ),
      { params: Promise.resolve({ id }) }
    )

  const create = (
    sourceActorId: string,
    { filtered = true, actorId = ACTOR1_ID } = {}
  ) =>
    database.createNotification({
      actorId,
      type: NotificationType.enum.follow,
      sourceActorId,
      filtered
    })

  const remaining = (actorId = ACTOR1_ID) =>
    database.getNotifications({ actorId, limit: 100, includeFiltered: true })

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await post('anything')

    expect(response.status).toBe(500)
  })

  it('deletes the sender filtered notifications and leaves other senders alone', async () => {
    await create(ACTOR2_ID)
    await create(ACTOR2_ID)
    const other = await create(ACTOR3_ID)

    const response = await post(await actorPublicId(database, ACTOR2_ID))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect((await remaining()).map((n) => n.id)).toEqual([other.id])
  })

  it('keeps visible notifications from the dismissed sender', async () => {
    await create(ACTOR2_ID, { filtered: true })
    const visible = await create(ACTOR2_ID, { filtered: false })

    await post(await actorPublicId(database, ACTOR2_ID))

    expect((await remaining()).map((n) => n.id)).toEqual([visible.id])
  })

  it('accepts the sender as a raw actor uri', async () => {
    await create(ACTOR2_ID)

    const response = await post(ACTOR2_ID)

    expect(response.status).toBe(200)
    expect(await remaining()).toEqual([])
  })

  it('returns 404 and deletes nothing when there is no pending request', async () => {
    const visible = await create(ACTOR2_ID, { filtered: false })
    const theirs = await create(ACTOR2_ID, { actorId: ACTOR3_ID })

    const response = await post(await actorPublicId(database, ACTOR2_ID))

    expect(response.status).toBe(404)
    expect((await remaining()).map((n) => n.id)).toEqual([visible.id])
    expect((await remaining(ACTOR3_ID)).map((n) => n.id)).toEqual([theirs.id])
  })
})

import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
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
        context: { currentActor: { id: string }; params: Promise<{}> }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, {
        currentActor: { id: 'https://llun.test/users/test1' },
        params: context.params
      })
}))

describe('POST /api/v1/notifications/read', () => {
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

  afterEach(() => {
    mockDatabase = database
  })

  const post = (body: unknown) =>
    POST(
      new NextRequest('https://llun.test/api/v1/notifications/read', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { 'content-type': 'application/json' }
      }),
      { params: Promise.resolve({}) }
    )

  const create = (
    actorId: string,
    overrides: { filtered?: boolean; sourceActorId?: string } = {}
  ) =>
    database.createNotification({
      actorId,
      type: NotificationType.enum.follow,
      sourceActorId: overrides.sourceActorId ?? ACTOR3_ID,
      filtered: overrides.filtered
    })

  const isRead = async (actorId: string, id: string) =>
    (
      await database.getNotifications({
        actorId,
        limit: 100,
        ids: [id],
        includeFiltered: true
      })
    )[0].isRead

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await post({ notification_ids: ['a'] })

    expect(response.status).toBe(500)
  })

  // Every body names the notification we then check, so the 400 is the only
  // thing keeping it unread.
  it.each([
    ['a body that is not JSON', (id: string) => `{"notification_ids":["${id}"`],
    ['a missing notification_ids', (id: string) => ({ notification_id: id })],
    [
      'an empty-string id next to a valid one',
      (id: string) => ({ notification_ids: [id, ''] })
    ],
    [
      'a non-string id next to a valid one',
      (id: string) => ({ notification_ids: [id, 1] })
    ]
  ])('rejects %s with 400 and marks nothing', async (_, body) => {
    const notification = await create(ACTOR1_ID)

    const response = await post(body(notification.id))

    expect(response.status).toBe(400)
    expect(await isRead(ACTOR1_ID, notification.id)).toBe(false)
  })

  it('rejects an empty notification_ids list with 400', async () => {
    const response = await post({ notification_ids: [] })

    expect(response.status).toBe(400)
  })

  it('marks the listed notifications read and reports how many', async () => {
    const a = await create(ACTOR1_ID)
    const b = await create(ACTOR1_ID)
    const untouched = await create(ACTOR1_ID)

    const response = await post({ notification_ids: [a.id, b.id] })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, marked_read: 2 })
    expect(await isRead(ACTOR1_ID, a.id)).toBe(true)
    expect(await isRead(ACTOR1_ID, b.id)).toBe(true)
    expect(await isRead(ACTOR1_ID, untouched.id)).toBe(false)
  })

  it('records when the notification was read', async () => {
    const notification = await create(ACTOR1_ID)
    const readTime = new Date('2026-04-05T06:07:08.000Z').getTime()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(readTime)

    try {
      await post({ notification_ids: [notification.id] })
    } finally {
      vi.useRealTimers()
    }

    const [row] = await database.getNotifications({
      actorId: ACTOR1_ID,
      limit: 1,
      ids: [notification.id]
    })
    expect(row.readAt).toBe(readTime)
  })

  it("does not touch another recipient's notifications", async () => {
    const mine = await create(ACTOR1_ID)
    const theirs = await create(ACTOR2_ID)

    const response = await post({ notification_ids: [mine.id, theirs.id] })

    expect(await response.json()).toEqual({ success: true, marked_read: 1 })
    expect(await isRead(ACTOR1_ID, mine.id)).toBe(true)
    expect(await isRead(ACTOR2_ID, theirs.id)).toBe(false)
  })

  it('reports zero for ids that do not exist', async () => {
    const response = await post({ notification_ids: ['does-not-exist'] })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, marked_read: 0 })
  })

  it('also marks policy-filtered notifications read', async () => {
    const filtered = await create(ACTOR1_ID, { filtered: true })

    const response = await post({ notification_ids: [filtered.id] })

    expect(await response.json()).toEqual({ success: true, marked_read: 1 })
    expect(await isRead(ACTOR1_ID, filtered.id)).toBe(true)
  })
})

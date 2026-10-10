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
          params: Promise<{ group_key: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ group_key: string }> }) =>
      handle(req, {
        currentActor: { id: 'https://llun.test/users/test1' },
        params: context.params
      })
}))

interface Envelope {
  notification_groups: {
    group_key: string
    notifications_count: number
    type: string
    sample_account_ids: string[]
    status_id?: string
  }[]
  accounts: { id: string }[]
  statuses: { id: string }[]
}

describe('GET /api/v2/notifications/[group_key]', () => {
  const database = getTestSQLDatabase()
  const statusId = `${ACTOR1_ID}/statuses/group-key-status`
  const groupKey = `like:${statusId}`

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'A status with likes',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
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
    const records = await database.getFilterRecordsForActor({
      actorId: ACTOR1_ID
    })
    for (const { filter } of records) {
      await database.deleteFilter({ actorId: ACTOR1_ID, id: filter.id })
    }
  })

  afterEach(() => {
    mockDatabase = database
  })

  const get = (key: string) =>
    GET(
      new NextRequest(
        `https://llun.test/api/v2/notifications/${encodeURIComponent(key)}`
      ),
      { params: Promise.resolve({ group_key: key }) }
    )

  const like = (sourceActorId: string, extra = {}) =>
    database.createNotification({
      actorId: ACTOR1_ID,
      type: NotificationType.enum.like,
      sourceActorId,
      statusId,
      groupKey,
      ...extra
    })

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await get(groupKey)

    expect(response.status).toBe(500)
  })

  it('returns the whole group with its accounts and status', async () => {
    await like(ACTOR2_ID)
    await like(ACTOR3_ID)

    const response = await get(groupKey)
    const data: Envelope = await response.json()

    expect(response.status).toBe(200)
    expect(data.notification_groups).toHaveLength(1)
    expect(data.notification_groups[0]).toMatchObject({
      group_key: groupKey,
      notifications_count: 2,
      type: 'favourite',
      status_id: await statusPublicId(database, statusId)
    })
    const [actor2, actor3] = await Promise.all([
      actorPublicId(database, ACTOR2_ID),
      actorPublicId(database, ACTOR3_ID)
    ])
    expect(data.notification_groups[0].sample_account_ids.sort()).toEqual(
      [actor2, actor3].sort()
    )
    expect(data.accounts.map((a) => a.id).sort()).toEqual(
      [actor2, actor3].sort()
    )
    expect(data.statuses.map((s) => s.id)).toEqual([
      await statusPublicId(database, statusId)
    ])
  })

  it('addresses a single notification through its ungrouped- key', async () => {
    const first = await like(ACTOR2_ID)
    await like(ACTOR3_ID)

    const response = await get(`ungrouped-${first.id}`)
    const data: Envelope = await response.json()

    expect(response.status).toBe(200)
    // Only the addressed row, even though it shares a stored groupKey.
    expect(data.notification_groups).toHaveLength(1)
    expect(data.notification_groups[0]).toMatchObject({
      group_key: `ungrouped-${first.id}`,
      notifications_count: 1,
      sample_account_ids: [await actorPublicId(database, ACTOR2_ID)]
    })
  })

  it('groups every row of an explicit key even for types that are not groupable by default', async () => {
    const mentionKey = `mention:${statusId}`
    for (const source of [ACTOR2_ID, ACTOR3_ID]) {
      await database.createNotification({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.mention,
        sourceActorId: source,
        statusId,
        groupKey: mentionKey
      })
    }

    const data: Envelope = await (await get(mentionKey)).json()

    expect(data.notification_groups).toHaveLength(1)
    expect(data.notification_groups[0]).toMatchObject({
      group_key: mentionKey,
      notifications_count: 2,
      type: 'mention'
    })
  })

  it('returns 404 for an unknown group key', async () => {
    const response = await get('like:nothing-here')

    expect(response.status).toBe(404)
  })

  it("returns 404 for another recipient's group", async () => {
    await database.createNotification({
      actorId: ACTOR2_ID,
      type: NotificationType.enum.like,
      sourceActorId: ACTOR3_ID,
      statusId,
      groupKey: 'like:someone-elses'
    })

    const response = await get('like:someone-elses')

    expect(response.status).toBe(404)
  })

  it('returns 404 when the only notifications were routed to the requests queue', async () => {
    await like(ACTOR2_ID, { filtered: true })

    const response = await get(groupKey)

    expect(response.status).toBe(404)
  })

  it('returns 404 when the referenced status no longer exists', async () => {
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: NotificationType.enum.like,
      sourceActorId: ACTOR2_ID,
      statusId: `${ACTOR1_ID}/statuses/deleted`,
      groupKey: 'like:deleted'
    })

    const response = await get('like:deleted')

    expect(response.status).toBe(404)
  })

  it('returns 404 when a hide filter removes the referenced status', async () => {
    await like(ACTOR2_ID)
    await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Hide likes target',
      context: ['notifications'],
      filterAction: 'hide',
      expiresAt: null,
      keywords: [{ keyword: 'status with likes', wholeWord: false }]
    })

    const response = await get(groupKey)

    expect(response.status).toBe(404)
  })
})

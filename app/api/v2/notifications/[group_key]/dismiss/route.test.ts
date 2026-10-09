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

describe('POST /api/v2/notifications/[group_key]/dismiss', () => {
  const database = getTestSQLDatabase()
  const groupKey = 'like:https://llun.test/users/test1/statuses/dismiss-group'

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

  const post = (key: string) =>
    POST(
      new NextRequest(
        `https://llun.test/api/v2/notifications/${encodeURIComponent(key)}/dismiss`,
        { method: 'POST' }
      ),
      { params: Promise.resolve({ group_key: key }) }
    )

  const create = (
    overrides: {
      actorId?: string
      groupKey?: string
      filtered?: boolean
      sourceActorId?: string
    } = {}
  ) =>
    database.createNotification({
      actorId: overrides.actorId ?? ACTOR1_ID,
      type: NotificationType.enum.like,
      sourceActorId: overrides.sourceActorId ?? ACTOR2_ID,
      groupKey: 'groupKey' in overrides ? overrides.groupKey : groupKey,
      filtered: overrides.filtered
    })

  const remaining = async (actorId = ACTOR1_ID) =>
    (
      await database.getNotifications({
        actorId,
        limit: 100,
        includeFiltered: true
      })
    ).map((n) => n.id)

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await post(groupKey)

    expect(response.status).toBe(500)
  })

  it('deletes every notification in the group and nothing else', async () => {
    await create()
    await create({ sourceActorId: ACTOR3_ID })
    const other = await create({ groupKey: 'like:another-group' })

    const response = await post(groupKey)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(await remaining()).toEqual([other.id])
  })

  it('deletes only the addressed notification for an ungrouped- key', async () => {
    const target = await create()
    const sibling = await create({ sourceActorId: ACTOR3_ID })

    await post(`ungrouped-${target.id}`)

    expect(await remaining()).toEqual([sibling.id])
  })

  it("does not delete another recipient's group", async () => {
    const theirs = await create({ actorId: ACTOR2_ID })

    await post(groupKey)

    expect(await remaining(ACTOR2_ID)).toEqual([theirs.id])
  })

  it('keeps policy-filtered notifications that share the key so pending requests are not lost', async () => {
    await create()
    const pending = await create({ filtered: true })

    await post(groupKey)

    expect(await remaining()).toEqual([pending.id])
  })

  it('succeeds when the group does not exist', async () => {
    const response = await post('like:never-existed')

    expect(response.status).toBe(200)
  })
})

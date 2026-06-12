import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { getTrendingStatuses } from './trendingStatuses'

const FIRST_ACTOR_ID = 'https://llun.test/users/first'
const SECOND_ACTOR_ID = 'https://llun.test/users/second'
const THIRD_ACTOR_ID = 'https://llun.test/users/third'

const DAY_MS = 86_400_000

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const database = getTestSQLDatabase()
  await database.migrate()
  try {
    await test(database)
  } finally {
    await database.destroy()
  }
}

const createActor = (database: Database, id: string, username: string) =>
  database.createActor({
    actorId: id,
    username,
    domain: 'llun.test',
    inboxUrl: `${id}/inbox`,
    sharedInboxUrl: 'https://llun.test/inbox',
    followersUrl: `${id}/followers`,
    publicKey: 'public-key',
    privateKey: 'private-key',
    createdAt: 1
  })

const createPublicNote = (
  database: Database,
  {
    actorId,
    id,
    createdAt,
    reply
  }: { actorId: string; id: string; createdAt: number; reply?: string }
) =>
  database.createNote({
    id,
    url: id,
    actorId,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    text: 'Trending candidate',
    ...(reply ? { reply } : null),
    createdAt
  })

describe('getTrendingStatuses', () => {
  it('ranks statuses by interaction score and drops zero-score statuses', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')
      await createActor(database, SECOND_ACTOR_ID, 'second')
      await createActor(database, THIRD_ACTOR_ID, 'third')

      const now = Date.now()
      const statusAId = `${FIRST_ACTOR_ID}/statuses/a`
      const statusBId = `${FIRST_ACTOR_ID}/statuses/b`
      const statusCId = `${FIRST_ACTOR_ID}/statuses/c`
      await createPublicNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: statusAId,
        createdAt: now - 3000
      })
      await createPublicNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: statusBId,
        createdAt: now - 2000
      })
      // The newest status has no interactions — it must not outrank scored ones.
      await createPublicNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: statusCId,
        createdAt: now - 1000
      })

      // B: two likes + one boost → score 2 + 2 × 1 = 4.
      await database.createLike({
        actorId: SECOND_ACTOR_ID,
        statusId: statusBId
      })
      await database.createLike({
        actorId: THIRD_ACTOR_ID,
        statusId: statusBId
      })
      await database.createAnnounce({
        id: `${SECOND_ACTOR_ID}/statuses/boost-b`,
        actorId: SECOND_ACTOR_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusBId
      })
      // A: one like → score 1.
      await database.createLike({
        actorId: SECOND_ACTOR_ID,
        statusId: statusAId
      })

      const statuses = await getTrendingStatuses({
        database,
        limit: 10,
        offset: 0
      })
      expect(statuses.map((status) => status.id)).toEqual([
        statusBId,
        statusAId
      ])
    })
  })

  it('counts replies toward the score', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')
      await createActor(database, SECOND_ACTOR_ID, 'second')

      const now = Date.now()
      const parentStatusId = `${FIRST_ACTOR_ID}/statuses/parent`
      await createPublicNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: parentStatusId,
        createdAt: now - 2000
      })
      await createPublicNote(database, {
        actorId: SECOND_ACTOR_ID,
        id: `${SECOND_ACTOR_ID}/statuses/reply`,
        createdAt: now - 1500,
        reply: parentStatusId
      })
      // A newer status without interactions stays out of the ranking.
      await createPublicNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/quiet`,
        createdAt: now - 1000
      })

      const statuses = await getTrendingStatuses({
        database,
        limit: 10,
        offset: 0
      })
      expect(statuses.map((status) => status.id)).toEqual([parentStatusId])
    })
  })

  it('breaks score ties by newest first and slices with offset and limit', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')
      await createActor(database, SECOND_ACTOR_ID, 'second')

      const now = Date.now()
      // Three statuses with one like each — ties order newest first.
      const statusIds = [1, 2, 3].map(
        (index) => `${FIRST_ACTOR_ID}/statuses/${index}`
      )
      for (const [index, statusId] of statusIds.entries()) {
        await createPublicNote(database, {
          actorId: FIRST_ACTOR_ID,
          id: statusId,
          createdAt: now - 3000 + index * 1000
        })
        await database.createLike({
          actorId: SECOND_ACTOR_ID,
          statusId
        })
      }
      const [oldest, middle, newest] = statusIds

      const fullPage = await getTrendingStatuses({
        database,
        limit: 10,
        offset: 0
      })
      expect(fullPage.map((status) => status.id)).toEqual([
        newest,
        middle,
        oldest
      ])

      const firstPage = await getTrendingStatuses({
        database,
        limit: 2,
        offset: 0
      })
      expect(firstPage.map((status) => status.id)).toEqual([newest, middle])

      const secondPage = await getTrendingStatuses({
        database,
        limit: 2,
        offset: 2
      })
      expect(secondPage.map((status) => status.id)).toEqual([oldest])

      const beyondEnd = await getTrendingStatuses({
        database,
        limit: 5,
        offset: 3
      })
      expect(beyondEnd).toEqual([])
    })
  })

  it('excludes liked statuses created outside the seven-day window', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')
      await createActor(database, SECOND_ACTOR_ID, 'second')

      const now = Date.now()
      const freshStatusId = `${FIRST_ACTOR_ID}/statuses/fresh`
      const oldStatusId = `${FIRST_ACTOR_ID}/statuses/old`
      await createPublicNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: freshStatusId,
        createdAt: now - 1000
      })
      // Liked, but eight days old — outside the seven-day window.
      await createPublicNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: oldStatusId,
        createdAt: now - 8 * DAY_MS
      })
      await database.createLike({
        actorId: SECOND_ACTOR_ID,
        statusId: freshStatusId
      })
      await database.createLike({
        actorId: SECOND_ACTOR_ID,
        statusId: oldStatusId
      })

      const statuses = await getTrendingStatuses({
        database,
        limit: 10,
        offset: 0
      })
      expect(statuses.map((status) => status.id)).toEqual([freshStatusId])
    })
  })
})

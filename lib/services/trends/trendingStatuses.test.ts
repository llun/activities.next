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

  it('weights reblogs double so a boosted status outranks a more-liked one', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')
      await createActor(database, SECOND_ACTOR_ID, 'second')
      await createActor(database, THIRD_ACTOR_ID, 'third')

      const now = Date.now()
      const boostedStatusId = `${FIRST_ACTOR_ID}/statuses/boosted`
      const likedStatusId = `${FIRST_ACTOR_ID}/statuses/liked`
      // The liked status is newer, so a like-only or tied ordering would put
      // it first — only the reblog term can flip the order.
      await createPublicNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: boostedStatusId,
        createdAt: now - 2000
      })
      await createPublicNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: likedStatusId,
        createdAt: now - 1000
      })

      // liked: three likes, no boosts → score 3.
      for (const actorId of [FIRST_ACTOR_ID, SECOND_ACTOR_ID, THIRD_ACTOR_ID]) {
        await database.createLike({ actorId, statusId: likedStatusId })
      }
      // boosted: zero likes, two boosts → weighted score 2 × 2 = 4. At 1×
      // weight it would score 2 (losing to 3) and with reblogs dropped it
      // would score 0 (filtered out) — either regression breaks the order.
      await database.createAnnounce({
        id: `${SECOND_ACTOR_ID}/statuses/boost-boosted`,
        actorId: SECOND_ACTOR_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: boostedStatusId
      })
      await database.createAnnounce({
        id: `${THIRD_ACTOR_ID}/statuses/boost-boosted`,
        actorId: THIRD_ACTOR_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: boostedStatusId
      })

      const statuses = await getTrendingStatuses({
        database,
        limit: 10,
        offset: 0
      })
      expect(statuses.map((status) => status.id)).toEqual([
        boostedStatusId,
        likedStatusId
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

  it('hydrates the viewer like/bookmark/boost flags only when currentActorId is passed', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')
      await createActor(database, SECOND_ACTOR_ID, 'second')

      const now = Date.now()
      const statusId = `${FIRST_ACTOR_ID}/statuses/interacted`
      await createPublicNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: statusId,
        createdAt: now - 1000
      })

      // The viewer (SECOND_ACTOR) has liked, bookmarked, and boosted the post.
      const boostId = `${SECOND_ACTOR_ID}/statuses/boost-interacted`
      await database.createLike({ actorId: SECOND_ACTOR_ID, statusId })
      await database.createBookmark({ actorId: SECOND_ACTOR_ID, statusId })
      await database.createAnnounce({
        id: boostId,
        actorId: SECOND_ACTOR_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId
      })

      // Without a viewer the flags stay off (the Mastodon serialization path
      // derives them separately).
      const [anonymous] = await getTrendingStatuses({
        database,
        limit: 10,
        offset: 0
      })
      expect(anonymous).toMatchObject({
        id: statusId,
        isActorLiked: false,
        isActorBookmarked: false,
        actorAnnounceStatusId: null
      })

      // With the viewer the domain status carries their interaction state so the
      // web UI's action buttons render the correct initial state.
      const [forViewer] = await getTrendingStatuses({
        database,
        limit: 10,
        offset: 0,
        currentActorId: SECOND_ACTOR_ID
      })
      expect(forViewer).toMatchObject({
        id: statusId,
        isActorLiked: true,
        isActorBookmarked: true,
        actorAnnounceStatusId: boostId
      })
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

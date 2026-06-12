import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const FIRST_ACTOR_ID = 'https://llun.test/users/first'
const SECOND_ACTOR_ID = 'https://llun.test/users/second'

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

const createTaggedNote = async (
  database: Database,
  {
    actorId,
    id,
    tag,
    createdAt,
    isPublic = true
  }: {
    actorId: string
    id: string
    tag: string
    createdAt: number
    isPublic?: boolean
  }
) => {
  await database.createNote({
    id,
    url: id,
    actorId,
    to: isPublic ? [ACTIVITY_STREAM_PUBLIC] : [`${actorId}/followers`],
    cc: [],
    text: `Post about #${tag}`,
    createdAt
  })
  await database.createTag({
    statusId: id,
    type: 'hashtag',
    name: `#${tag}`,
    value: `https://llun.test/tags/${tag.toLowerCase()}`
  })
}

describe('getTrendingTags', () => {
  it('ranks tags by distinct status uses with distinct account counts', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')
      await createActor(database, SECOND_ACTOR_ID, 'second')

      const now = Date.now()
      // alpha: three statuses by two actors (mixed casing normalizes together).
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/1`,
        tag: 'Alpha',
        createdAt: now - 1000
      })
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/2`,
        tag: 'alpha',
        createdAt: now - 2000
      })
      await createTaggedNote(database, {
        actorId: SECOND_ACTOR_ID,
        id: `${SECOND_ACTOR_ID}/statuses/1`,
        tag: 'alpha',
        createdAt: now - 3000
      })
      // beta: one status by one actor.
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/3`,
        tag: 'beta',
        createdAt: now - 4000
      })

      const tags = await database.getTrendingTags({
        days: 7,
        limit: 10,
        offset: 0
      })
      expect(tags).toEqual([
        { name: 'alpha', uses: 3, accounts: 2 },
        { name: 'beta', uses: 1, accounts: 1 }
      ])
    })
  })

  it('excludes tag uses outside the day window', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')

      const now = Date.now()
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/1`,
        tag: 'fresh',
        createdAt: now - 1000
      })
      // Used eight days ago — outside a seven-day window.
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/2`,
        tag: 'old',
        createdAt: now - 8 * DAY_MS
      })

      const tags = await database.getTrendingTags({
        days: 7,
        limit: 10,
        offset: 0
      })
      expect(tags).toEqual([{ name: 'fresh', uses: 1, accounts: 1 }])
    })
  })

  it('aligns the window start to the oldest rendered UTC day bucket', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')

      const todayBucketMs = Math.floor(Date.now() / DAY_MS) * DAY_MS
      const oldestBucketMs = todayBucketMs - 6 * DAY_MS
      // First instant of the oldest rendered bucket — still counted.
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/1`,
        tag: 'edge',
        createdAt: oldestBucketMs
      })
      // Just before the oldest rendered bucket: inside a rolling 7×24h window
      // but in an eighth UTC day bucket the route never renders — it must not
      // count toward the ranking.
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/2`,
        tag: 'edge',
        createdAt: oldestBucketMs - 1000
      })

      const tags = await database.getTrendingTags({
        days: 7,
        limit: 10,
        offset: 0
      })
      expect(tags).toEqual([{ name: 'edge', uses: 1, accounts: 1 }])
    })
  })

  it('ignores tags carried only by non-public statuses', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')

      const now = Date.now()
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/1`,
        tag: 'open',
        createdAt: now - 1000
      })
      // Followers-only status — its tag never trends.
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/2`,
        tag: 'secret',
        createdAt: now - 2000,
        isPublic: false
      })

      const tags = await database.getTrendingTags({
        days: 7,
        limit: 10,
        offset: 0
      })
      expect(tags).toEqual([{ name: 'open', uses: 1, accounts: 1 }])
    })
  })

  it('slices equally ranked tags deterministically with offset and limit', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')

      const now = Date.now()
      // Three tags with one use each — ties order by tag name ascending.
      for (const [index, tag] of ['ccc', 'aaa', 'bbb'].entries()) {
        await createTaggedNote(database, {
          actorId: FIRST_ACTOR_ID,
          id: `${FIRST_ACTOR_ID}/statuses/${index}`,
          tag,
          createdAt: now - 1000 - index
        })
      }

      const firstPage = await database.getTrendingTags({
        days: 7,
        limit: 1,
        offset: 0
      })
      expect(firstPage).toEqual([{ name: 'aaa', uses: 1, accounts: 1 }])

      const rest = await database.getTrendingTags({
        days: 7,
        limit: 2,
        offset: 1
      })
      expect(rest).toEqual([
        { name: 'bbb', uses: 1, accounts: 1 },
        { name: 'ccc', uses: 1, accounts: 1 }
      ])
    })
  })
})

describe('getTagDailyHistory', () => {
  it('buckets same-day uses together and splits different days apart', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')
      await createActor(database, SECOND_ACTOR_ID, 'second')

      const todayBucketMs = Math.floor(Date.now() / DAY_MS) * DAY_MS
      // Two uses by two actors inside the same UTC day bucket.
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/1`,
        tag: 'daily',
        createdAt: todayBucketMs + 1000
      })
      await createTaggedNote(database, {
        actorId: SECOND_ACTOR_ID,
        id: `${SECOND_ACTOR_ID}/statuses/1`,
        tag: 'daily',
        createdAt: todayBucketMs + 2000
      })
      // One use the day before lands in its own bucket.
      await createTaggedNote(database, {
        actorId: FIRST_ACTOR_ID,
        id: `${FIRST_ACTOR_ID}/statuses/2`,
        tag: 'daily',
        createdAt: todayBucketMs - DAY_MS + 1000
      })

      const history = await database.getTagDailyHistory({
        names: ['daily'],
        days: 7
      })
      expect(history.get('daily')).toEqual([
        { dayBucketMs: todayBucketMs, uses: 2, accounts: 2 },
        { dayBucketMs: todayBucketMs - DAY_MS, uses: 1, accounts: 1 }
      ])
    })
  })

  it('returns an empty history list for a tag with no uses in the window', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, FIRST_ACTOR_ID, 'first')
      const history = await database.getTagDailyHistory({
        names: ['unused'],
        days: 7
      })
      expect(history.get('unused')).toEqual([])
    })
  })
})

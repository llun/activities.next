import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Shrink the cap + slack so the trim boundary can be exercised with a handful of
// inserts instead of the real 1000/100. The mixin reads these constants at
// call-time inside trimCollectionFeed, so the mocked values drive the real
// algorithm. Every other export is preserved so unrelated imports keep working.
// vi.hoisted lets the mock factory (hoisted above normal consts) share the same
// numbers the test body asserts against.
const { TEST_MAX_ROWS, TEST_TRIM_SLACK } = vi.hoisted(() => ({
  TEST_MAX_ROWS: 10,
  TEST_TRIM_SLACK: 2
}))
vi.mock('@/lib/services/timelines/types', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/timelines/types')>()),
  COLLECTION_FEED_MAX_ROWS: TEST_MAX_ROWS,
  COLLECTION_FEED_TRIM_SLACK: TEST_TRIM_SLACK
}))

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const database = getTestSQLDatabase()
  try {
    // Inside the try so a migrate failure still runs destroy() and never leaks
    // the connection.
    await database.migrate()
    await test(database)
  } finally {
    await database.destroy()
  }
}

const createLocalAccount = (database: Database, username: string) =>
  database.createAccount({
    email: `${username}@${TEST_DOMAIN}`,
    username,
    passwordHash: 'hash',
    domain: TEST_DOMAIN,
    privateKey: `privateKey-${username}`,
    publicKey: `publicKey-${username}`
  })

const actor = async (database: Database, username: string) => {
  const found = await database.getActorFromUsername({
    username,
    domain: TEST_DOMAIN
  })
  if (!found) throw new Error(`${username} not created`)
  return found
}

// Create a public note authored by `actorId` and fan it into the collection
// feed (the same path a freshly-arrived status takes). `index` drives a strictly
// increasing createdAt so newest/oldest ordering is deterministic.
const addFanedNote = async (
  database: Database,
  actorId: string,
  index: number
) => {
  const id = `${actorId}/statuses/cap-${index}`
  const status = await database.createNote({
    id,
    url: id,
    actorId,
    text: `note ${index}`,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    reply: '',
    createdAt: 1_700_000_000_000 + index
  })
  await database.addStatusToCollectionTimelines({ status })
  return status
}

const localId = (statusId: string) => statusId.split('/').pop() as string

const setupCollectionWithMember = async (database: Database) => {
  for (const name of ['owner', 'member']) {
    await createLocalAccount(database, name)
  }
  const owner = await actor(database, 'owner')
  const member = await actor(database, 'member')
  const collection = await database.createCollection({
    actorId: owner.id,
    title: 'Feed'
  })
  await database.addCollectionMembers({
    id: collection.id,
    actorId: owner.id,
    targetActorIds: [member.id]
  })
  return { owner, member, collection }
}

describe('collection feed cap', () => {
  it('keeps only the newest COLLECTION_FEED_MAX_ROWS once the feed overshoots the slack', async () => {
    await withFreshDatabase(async (database) => {
      const { owner, member, collection } =
        await setupCollectionWithMember(database)

      // One past the trim threshold (MAX + SLACK), so exactly one insert tips it
      // over and trimming runs.
      const total = TEST_MAX_ROWS + TEST_TRIM_SLACK + 1
      for (let index = 1; index <= total; index++) {
        await addFanedNote(database, member.id, index)
      }

      const feed = await database.getCollectionTimeline({
        id: collection.id,
        actorId: owner.id,
        limit: 100
      })
      const ids = feed.map((status) => localId(status.id))

      // Trimmed back down to exactly the cap.
      expect(feed).toHaveLength(TEST_MAX_ROWS)
      // The newest cap-worth of posts survive (cap-13 … cap-4 with these consts).
      expect(ids).toContain(`cap-${total}`)
      expect(ids).toContain(`cap-${total - TEST_MAX_ROWS + 1}`)
      // The oldest overflow posts are evicted (cap-1 … cap-3).
      for (let index = 1; index <= total - TEST_MAX_ROWS; index++) {
        expect(ids).not.toContain(`cap-${index}`)
      }
      // Newest first.
      expect(ids[0]).toBe(`cap-${total}`)
    })
  })

  it('does not trim until the feed exceeds the cap plus slack', async () => {
    await withFreshDatabase(async (database) => {
      const { owner, member, collection } =
        await setupCollectionWithMember(database)

      // Exactly at the threshold (MAX + SLACK): the batched trim only fires once
      // the feed *exceeds* it, so every row is still present here.
      const total = TEST_MAX_ROWS + TEST_TRIM_SLACK
      for (let index = 1; index <= total; index++) {
        await addFanedNote(database, member.id, index)
      }

      const feed = await database.getCollectionTimeline({
        id: collection.id,
        actorId: owner.id,
        limit: 100
      })
      expect(feed).toHaveLength(total)
    })
  })
})

import {
  createSearchActor,
  seedStatus,
  seedTag
} from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

const DAY = 86_400_000
const HOUR = 3_600_000
const DAY0 = Date.UTC(2024, 0, 15)
const NOW = DAY0 + 12 * HOUR
// With days = 2 the window starts at the start of yesterday (UTC).
const WINDOW_START = DAY0 - DAY
const PUBLIC = ACTIVITY_STREAM_PUBLIC
const actorIdOf = (username: string) => `https://tq.test/users/${username}`
const LOCAL = actorIdOf('local')
const OTHER = actorIdOf('other')

// Trends read every status, so each test starts from empty status tables.
type TestDb = ReturnType<typeof createTestDatabase>
const testDb: TestDb = createTestDatabase()
const withDatabase = async (test: (testDb: TestDb) => Promise<void>) => {
  for (const table of ['tags', 'recipients', 'statuses'] as const) {
    await testDb.db.deleteFrom(table).execute()
  }
  await test(testDb)
}

beforeAll(async () => {
  await testDb.prepare()
  await testDb.database.migrate()
  for (const [id, username] of [
    [LOCAL, 'local'],
    [OTHER, 'other']
  ]) {
    await createSearchActor(testDb.database, {
      id,
      username,
      domain: 'tq.test'
    })
  }
})

afterAll(async () => {
  await testDb.database.destroy()
})

let statusCount = 0
// A status with the given tags, each in its default `#name` stored form
// unless given as [name, nameNormalized, type?].
const tagged = async (
  db: TestDb['db'],
  {
    actorId = LOCAL,
    createdAt,
    tags,
    type,
    to = [PUBLIC],
    cc
  }: {
    actorId?: string
    createdAt: number
    tags: (string | [string, string, string?])[]
    type?: string
    to?: string[]
    cc?: string[]
  }
) => {
  statusCount += 1
  const statusId = await seedStatus(db, {
    id: `${actorId}/statuses/tagged-${statusCount}`,
    actorId,
    createdAt,
    type,
    to,
    cc
  })
  for (const tag of tags) {
    if (typeof tag === 'string') {
      await seedTag(db, { statusId, name: tag })
    } else {
      const [name, nameNormalized, tagType] = tag
      await seedTag(db, { statusId, name, nameNormalized, type: tagType })
    }
  }
  return statusId
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getTrendingTags', () => {
  it('counts distinct statuses and authors of public Note and Poll hashtags in the window', async () => {
    await withDatabase(async ({ database, db }) => {
      // Counted: a Note at the window start, a Poll with the public
      // collection in cc and the bare stored form, a Note to the compact
      // public id carrying both forms, and another author's Note.
      await tagged(db, {
        createdAt: WINDOW_START,
        tags: ['#tq1', '#tq2', '#tq3']
      })
      await tagged(db, {
        createdAt: DAY0 + HOUR,
        type: 'Poll',
        to: [],
        cc: [PUBLIC],
        tags: [['tq1', 'tq1']]
      })
      await tagged(db, {
        createdAt: DAY0,
        to: [ACTIVITY_STREAM_PUBLIC_COMPACT],
        tags: ['#tq1', ['tq1', 'tq1']]
      })
      await tagged(db, {
        actorId: OTHER,
        createdAt: DAY0,
        tags: ['#tq1', '#tq2']
      })
      // Not counted: just before the window, an Announce, followers-only,
      // no recipients, and a mention carrying the name.
      await tagged(db, { createdAt: WINDOW_START - 1, tags: ['#tq1'] })
      await tagged(db, { createdAt: DAY0, type: 'Announce', tags: ['#tq1'] })
      await tagged(db, {
        createdAt: DAY0,
        to: [`${LOCAL}/followers`],
        tags: ['#tq1']
      })
      await tagged(db, { createdAt: DAY0, to: [], tags: ['#tq1'] })
      await tagged(db, {
        createdAt: DAY0,
        tags: [['#tq1', '#tq1', 'mention']]
      })

      await expect(
        database.getTrendingTags({ days: 2, limit: 10, offset: 0 })
      ).resolves.toEqual([
        { name: 'tq1', uses: 4, accounts: 2 },
        { name: 'tq2', uses: 2, accounts: 2 },
        { name: 'tq3', uses: 1, accounts: 1 }
      ])
    })
  })

  it('ranks by uses, then name, and slices with offset and limit', async () => {
    await withDatabase(async ({ database, db }) => {
      for (const [name, uses] of [
        ['tqb', 2],
        ['tqd', 3],
        ['tqa', 1],
        ['tqc', 1]
      ] as const) {
        for (let index = 0; index < uses; index += 1) {
          await tagged(db, { createdAt: DAY0, tags: [`#${name}`] })
        }
      }

      const names = async (limit: number, offset: number) =>
        (await database.getTrendingTags({ days: 2, limit, offset })).map(
          (tag) => tag.name
        )
      await expect(names(10, 0)).resolves.toEqual(['tqd', 'tqb', 'tqa', 'tqc'])
      await expect(names(2, 1)).resolves.toEqual(['tqb', 'tqa'])
    })
  })
})

describe('getTrendingStatusCandidateIds', () => {
  it('returns local top-level public Notes and Polls in the window, newest first', async () => {
    await withDatabase(async ({ database, db }) => {
      const remote = actorIdOf('remote')
      const blankKey = actorIdOf('blank')
      for (const [id, username] of [
        [remote, 'remote'],
        [blankKey, 'blank']
      ]) {
        await createSearchActor(database, { id, username, domain: 'tq.test' })
      }
      await db
        .updateTable('actors')
        .set({ privateKey: null })
        .where('id', '=', remote)
        .execute()
      await db
        .updateTable('actors')
        .set({ privateKey: '' })
        .where('id', '=', blankKey)
        .execute()

      const status = (
        slug: string,
        createdAt: number,
        options: Partial<Parameters<typeof seedStatus>[1]> = {}
      ) =>
        seedStatus(db, {
          id: `${LOCAL}/statuses/${slug}`,
          actorId: LOCAL,
          createdAt,
          to: [PUBLIC],
          ...options
        })

      const atStart = await status('at-start', WINDOW_START)
      const note = await status('note', DAY0 + HOUR)
      const poll = await status('poll', DAY0 + 2 * HOUR, { type: 'Poll' })
      // Same time, inserted in reverse id order.
      const tieB = await status('tie-b', DAY0 + 3 * HOUR)
      const tieA = await status('tie-a', DAY0 + 3 * HOUR)

      await status('reply', DAY0 + 4 * HOUR, { reply: 'https://tq.test/p' })
      await status('announce', DAY0 + 5 * HOUR, { type: 'Announce' })
      await status('unlisted', DAY0 + 6 * HOUR, {
        to: [`${LOCAL}/followers`],
        cc: [PUBLIC]
      })
      await status('compact', DAY0 + 7 * HOUR, {
        to: [ACTIVITY_STREAM_PUBLIC_COMPACT]
      })
      await status('followers', DAY0 + 8 * HOUR, {
        to: [`${LOCAL}/followers`]
      })
      await status('before-window', WINDOW_START - 1)
      await status('remote', DAY0 + 9 * HOUR, { actorId: remote })
      await status('blank-key', DAY0 + 10 * HOUR, { actorId: blankKey })
      await status('no-actor', DAY0 + 11 * HOUR, {
        actorId: actorIdOf('missing')
      })

      await expect(
        database.getTrendingStatusCandidateIds({ days: 2 })
      ).resolves.toEqual([tieB, tieA, poll, note, atStart])
    })
  })

  it('caps the candidates at the newest 1000', async () => {
    await withDatabase(async ({ database, db }) => {
      const ids = Array.from(
        { length: 1001 },
        (_, index) => `${LOCAL}/statuses/bulk-${String(index).padStart(4, '0')}`
      )
      for (let start = 0; start < ids.length; start += 100) {
        const chunk = ids.slice(start, start + 100)
        await db
          .insertInto('statuses')
          .values(
            chunk.map((id, offset) => ({
              id,
              actorId: LOCAL,
              type: 'Note',
              reply: '',
              createdAt: new Date(DAY0 + start + offset),
              updatedAt: new Date(DAY0)
            }))
          )
          .execute()
        await db
          .insertInto('recipients')
          .values(
            chunk.map((id) => ({
              id: `${id}-to`,
              statusId: id,
              actorId: PUBLIC,
              type: 'to'
            }))
          )
          .execute()
      }

      const candidates = await database.getTrendingStatusCandidateIds({
        days: 2
      })
      expect(candidates).toHaveLength(1000)
      expect(candidates[0]).toBe(ids[1000])
      expect(candidates).not.toContain(ids[0])
    })
  })
})

describe('getTagDailyHistory', () => {
  it('buckets uses of the requested names per UTC day over both stored forms', async () => {
    await withDatabase(async ({ database, db }) => {
      await tagged(db, { createdAt: DAY0 + HOUR, tags: ['#tqh'] })
      await tagged(db, {
        actorId: OTHER,
        createdAt: DAY0 + 2 * HOUR,
        tags: [['tqh', 'tqh']]
      })
      await tagged(db, {
        createdAt: WINDOW_START + HOUR,
        tags: ['#tqh', ['tqh', 'tqh']]
      })
      // Not counted: before the window, followers-only, an Announce, a
      // spelling that only folds to the name, and another name.
      await tagged(db, { createdAt: WINDOW_START - 1, tags: ['#tqh'] })
      await tagged(db, {
        createdAt: DAY0,
        to: [`${LOCAL}/followers`],
        tags: ['#tqh']
      })
      await tagged(db, { createdAt: DAY0, type: 'Announce', tags: ['#tqh'] })
      await tagged(db, { createdAt: DAY0, tags: [['# tqh', '# tqh']] })
      await tagged(db, { createdAt: DAY0, tags: ['#tqunrequested'] })

      await expect(
        database.getTagDailyHistory({
          names: ['TQH', '#tqh', 'tqother', '', '#'],
          days: 2
        })
      ).resolves.toEqual(
        new Map([
          [
            'tqh',
            [
              { dayBucketMs: DAY0, uses: 2, accounts: 2 },
              { dayBucketMs: WINDOW_START, uses: 1, accounts: 1 }
            ]
          ],
          ['tqother', []]
        ])
      )
      await expect(
        database.getTagDailyHistory({ names: ['', '#'], days: 2 })
      ).resolves.toEqual(new Map())
    })
  })
})

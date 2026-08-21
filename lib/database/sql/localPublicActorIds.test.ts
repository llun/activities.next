import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { Timeline } from '@/lib/services/timelines/types'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// The two branches of `localPublicStatusesQuery`'s local-actor test, and the
// early return in front of them. All three are invisible to the rest of the
// suite: the feed's result-based tests pass whichever branch runs, and the
// early return is reached only on a database with no local actor at all —
// which is why `localPublicQueryShape.test.ts` has to seed one to get past it.
describe('local public timeline actor id handling', () => {
  const DOMAIN = 'llun.test'

  const seedLocalActor = (index: number) => {
    const id = `https://${DOMAIN}/users/bulk${index}`
    return {
      id,
      username: `bulk${index}`,
      domain: DOMAIN,
      type: 'Person',
      publicKey: 'publicKey',
      privateKey: 'a real key',
      // The row mapper requires these three, and the author of the seeded
      // status is hydrated when the feed reads it back.
      settings: JSON.stringify({
        followersUrl: `${id}/followers`,
        inboxUrl: `${id}/inbox`,
        sharedInboxUrl: `https://${DOMAIN}/inbox`
      }),
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }

  describe('with no local actors', () => {
    const { database, instance, prepare } = getTestDatabaseWithInstance(true)

    beforeAll(async () => {
      await prepare()
      await database.migrate()
    })

    afterAll(async () => {
      await database.destroy()
    })

    it('returns an empty feed and a zero count without querying statuses', async () => {
      const statements: string[] = []
      const listener = ({ sql }: { sql: string }) => statements.push(sql)
      instance.on('query', listener)
      try {
        expect(
          await database.getTimeline({ timeline: Timeline.LOCAL_PUBLIC })
        ).toEqual([])
        expect(await database.getLocalPublicStatusesCount()).toBe(0)
      } finally {
        instance.off('query', listener)
      }

      // The early return is an optimisation, so prove it actually returned
      // early rather than compiling an empty `IN ()` and asking anyway.
      expect(
        statements.filter((sql) => sql.includes('recipients'))
      ).toHaveLength(0)
    })
  })

  describe('with more local actors than the query can bind', () => {
    const { database, instance, prepare } = getTestDatabaseWithInstance(true)

    // Past the literal-id ceiling on BOTH backends, so the fallback semi-join
    // is the branch under test wherever this runs. The ceilings differ — 987 on
    // SQLite (999 bindings less the 12 reserved) and 1000 on PostgreSQL — so do
    // not "tighten" this to one past SQLite's: at 988 CI would stay green on
    // SQLite while PostgreSQL took the literal-id branch and failed the
    // assertion below. Inserted directly: this needs a thousand rows to exist,
    // not a thousand actors set up properly.
    const LOCAL_ACTOR_COUNT = 1001
    const AUTHOR_ID = `https://${DOMAIN}/users/bulk0`

    beforeAll(async () => {
      await prepare()
      await database.migrate()

      await instance.batchInsert(
        'actors',
        Array.from({ length: LOCAL_ACTOR_COUNT }, (_, index) =>
          seedLocalActor(index)
        ),
        50
      )

      await database.createNote({
        actorId: AUTHOR_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        id: `${AUTHOR_ID}/statuses/bulk-public`,
        text: 'Public status from a bulk-seeded local actor',
        url: `${AUTHOR_ID}/statuses/bulk-public`,
        reply: '',
        createdAt: Date.now()
      })
    }, 60000)

    afterAll(async () => {
      await database.destroy()
    })

    it('falls back to the semi-join and still returns the same rows', async () => {
      const statements: string[] = []
      const listener = ({ sql }: { sql: string }) => statements.push(sql)
      instance.on('query', listener)
      let statuses
      try {
        statuses = await database.getTimeline({
          timeline: Timeline.LOCAL_PUBLIC,
          limit: 30
        })
      } finally {
        instance.off('query', listener)
      }

      expect(statuses.map((status) => status.id)).toEqual([
        `${AUTHOR_ID}/statuses/bulk-public`
      ])
      expect(await database.getLocalPublicStatusesCount()).toBe(1)

      // Confirm it really took the fallback: the feed query names `actors`,
      // which the literal-id branch never does.
      const feedQuery = statements.find(
        (sql) => sql.includes('recipients') && sql.includes('statuses')
      )
      expect(feedQuery).toBeDefined()
      expect(feedQuery).toContain('actors')
    }, 30000)

    it('reads at most one id more than it can use', async () => {
      // The pluck is on an anonymous path, so it must not stream every local
      // actor id back only for the fallback to discard the list.
      const statements: string[] = []
      const listener = ({ sql }: { sql: string }) => statements.push(sql)
      instance.on('query', listener)
      try {
        await database.getTimeline({ timeline: Timeline.LOCAL_PUBLIC })
      } finally {
        instance.off('query', listener)
      }

      const idQuery = statements.find(
        (sql) => sql.includes('actors') && !sql.includes('statuses')
      )
      expect(idQuery).toBeDefined()
      expect(idQuery).toMatch(/limit/i)
    }, 30000)
  })
})

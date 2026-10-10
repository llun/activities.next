import { announcementQueries } from '@/lib/database/domains/announcement/queries'
import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'
import { withStaleFirstRead } from '@/lib/database/testing/staleRead'
import { Database } from '@/lib/database/types'
import { MAX_ANNOUNCEMENT_REACTION_NAMES } from '@/lib/services/announcements/reactionLimits'

const ACTOR1_ID = 'https://announcements.test/users/actor1'
const ACTOR2_ID = 'https://announcements.test/users/actor2'

const withFreshDatabase = async (
  test: (database: Database, testDb: TestDatabase) => Promise<void>
) => {
  const testDb = createTestDatabase()
  await testDb.prepare()
  await testDb.database.migrate()
  try {
    await test(testDb.database, testDb)
  } finally {
    await testDb.destroy()
  }
}

const HOUR = 60 * 60 * 1000

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('getActiveAnnouncements', () => {
  it.each([
    {
      description: 'excludes an unpublished announcement',
      create: { text: 'unpublished', published: false },
      active: false
    },
    {
      description:
        'excludes a published announcement whose startsAt is in the future',
      create: (now: number) => ({
        text: 'future start',
        published: true,
        startsAt: now + HOUR
      }),
      active: false
    },
    {
      description:
        'excludes a published announcement whose endsAt is in the past',
      create: (now: number) => ({
        text: 'past end',
        published: true,
        endsAt: now - HOUR
      }),
      active: false
    },
    {
      description: 'includes an open-ended published announcement',
      create: { text: 'open ended', published: true },
      active: true
    },
    {
      description:
        'includes a published announcement with startsAt in the past and endsAt in the future',
      create: (now: number) => ({
        text: 'in window',
        published: true,
        startsAt: now - HOUR,
        endsAt: now + HOUR
      }),
      active: true
    }
  ])('$description', async ({ create, active }) => {
    await withFreshDatabase(async (database) => {
      const now = Date.now()
      const params = typeof create === 'function' ? create(now) : create
      const created = await database.createAnnouncement(params)

      const activeAnnouncements = await database.getActiveAnnouncements({ now })
      const ids = activeAnnouncements.map((announcement) => announcement.id)
      if (active) {
        expect(ids).toContain(created.id)
      } else {
        expect(ids).not.toContain(created.id)
      }
    })
  })
})

describe('createAnnouncement', () => {
  it('sets publishedAt to the creation time when created published', async () => {
    await withFreshDatabase(async (database) => {
      const before = Date.now()
      const created = await database.createAnnouncement({
        text: 'hello',
        published: true
      })
      const after = Date.now()
      expect(created.publishedAt).not.toBeNull()
      expect(created.publishedAt as number).toBeGreaterThanOrEqual(before)
      expect(created.publishedAt as number).toBeLessThanOrEqual(after)
    })
  })

  it('leaves publishedAt null when created unpublished', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'draft',
        published: false
      })
      expect(created.publishedAt).toBeNull()
      expect(created.published).toBe(false)
    })
  })
})

describe('updateAnnouncement', () => {
  it('sets publishedAt on the unpublished to published transition', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'draft',
        published: false
      })
      expect(created.publishedAt).toBeNull()

      const before = Date.now()
      const updated = await database.updateAnnouncement({
        id: created.id,
        published: true
      })
      const after = Date.now()
      expect(updated).not.toBeNull()
      expect(updated?.published).toBe(true)
      expect(updated?.publishedAt).not.toBeNull()
      expect(updated?.publishedAt as number).toBeGreaterThanOrEqual(before)
      expect(updated?.publishedAt as number).toBeLessThanOrEqual(after)
    })
  })

  it('preserves the original publishedAt when republished after being unpublished', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'draft',
        published: false
      })
      expect(created.publishedAt).toBeNull()

      const firstPublish = await database.updateAnnouncement({
        id: created.id,
        published: true
      })
      const originalPublishedAt = firstPublish?.publishedAt
      expect(originalPublishedAt).not.toBeNull()

      // Space the timestamps so a re-stamp would produce a different value.
      await delay(5)
      await database.updateAnnouncement({ id: created.id, published: false })
      await delay(5)
      const republished = await database.updateAnnouncement({
        id: created.id,
        published: true
      })

      expect(republished?.published).toBe(true)
      expect(republished?.publishedAt).toBe(originalPublishedAt)
    })
  })

  it('returns null when the announcement does not exist', async () => {
    await withFreshDatabase(async (database) => {
      const updated = await database.updateAnnouncement({
        id: 'missing',
        text: 'nope'
      })
      expect(updated).toBeNull()
    })
  })

  it('updates the text and bumps updatedAt', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'original',
        published: false
      })
      const updated = await database.updateAnnouncement({
        id: created.id,
        text: 'changed'
      })
      expect(updated?.text).toBe('changed')
      expect(updated?.updatedAt as number).toBeGreaterThanOrEqual(
        created.updatedAt
      )
    })
  })
})

describe('getAnnouncements', () => {
  it('returns all announcements newest first by createdAt', async () => {
    await withFreshDatabase(async (database) => {
      const first = await database.createAnnouncement({
        text: 'first',
        published: false
      })
      // Space the creation timestamps so the newest-first ordering by createdAt
      // is deterministic rather than relying on same-millisecond tie behavior.
      await delay(5)
      const second = await database.createAnnouncement({
        text: 'second',
        published: true
      })

      const all = await database.getAnnouncements()
      expect(all.map((announcement) => announcement.id)).toEqual([
        second.id,
        first.id
      ])
    })
  })
})

describe('getAnnouncement', () => {
  it('returns the announcement matching the id', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'hello',
        published: true
      })

      const found = await database.getAnnouncement({ id: created.id })
      expect(found).not.toBeNull()
      expect(found?.id).toBe(created.id)
      expect(found?.text).toBe('hello')
      expect(found?.published).toBe(true)
    })
  })

  it('returns null when the announcement does not exist', async () => {
    await withFreshDatabase(async (database) => {
      expect(await database.getAnnouncement({ id: 'missing' })).toBeNull()
    })
  })
})

describe('markAnnouncementRead', () => {
  it('is idempotent when called twice for the same actor', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'read me',
        published: true
      })
      await database.markAnnouncementRead({
        announcementId: created.id,
        actorId: ACTOR1_ID
      })
      await expect(
        database.markAnnouncementRead({
          announcementId: created.id,
          actorId: ACTOR1_ID
        })
      ).resolves.toBeUndefined()
    })
  })
})

describe('getAnnouncementReadIds', () => {
  it('returns only the announcement ids the actor has read', async () => {
    await withFreshDatabase(async (database) => {
      const readAnnouncement = await database.createAnnouncement({
        text: 'read',
        published: true
      })
      const unreadAnnouncement = await database.createAnnouncement({
        text: 'unread',
        published: true
      })

      await database.markAnnouncementRead({
        announcementId: readAnnouncement.id,
        actorId: ACTOR1_ID
      })
      // Another actor reading does not affect actor1's read set.
      await database.markAnnouncementRead({
        announcementId: unreadAnnouncement.id,
        actorId: ACTOR2_ID
      })

      const readIds = await database.getAnnouncementReadIds({
        actorId: ACTOR1_ID,
        announcementIds: [readAnnouncement.id, unreadAnnouncement.id]
      })
      expect(readIds).toEqual([readAnnouncement.id])
    })
  })
})

describe('announcement reactions', () => {
  it('rolls up counts across actors and flags me only for the reacting actor', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'react',
        published: true
      })
      await database.addAnnouncementReaction({
        announcementId: created.id,
        actorId: ACTOR1_ID,
        name: 'tada'
      })
      await database.addAnnouncementReaction({
        announcementId: created.id,
        actorId: ACTOR2_ID,
        name: 'tada'
      })

      const forActor1 = await database.getAnnouncementReactions({
        announcementIds: [created.id],
        actorId: ACTOR1_ID
      })
      expect(forActor1).toEqual([
        { announcementId: created.id, name: 'tada', count: 2, me: true }
      ])

      const forOther = await database.getAnnouncementReactions({
        announcementIds: [created.id],
        actorId: 'https://announcements.test/users/other'
      })
      expect(forOther).toEqual([
        { announcementId: created.id, name: 'tada', count: 2, me: false }
      ])
    })
  })

  it('drops the count when a reaction is removed', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'react',
        published: true
      })
      await database.addAnnouncementReaction({
        announcementId: created.id,
        actorId: ACTOR1_ID,
        name: 'tada'
      })
      await database.addAnnouncementReaction({
        announcementId: created.id,
        actorId: ACTOR2_ID,
        name: 'tada'
      })

      await database.removeAnnouncementReaction({
        announcementId: created.id,
        actorId: ACTOR2_ID,
        name: 'tada'
      })

      const rollups = await database.getAnnouncementReactions({
        announcementIds: [created.id],
        actorId: ACTOR1_ID
      })
      expect(rollups).toEqual([
        { announcementId: created.id, name: 'tada', count: 1, me: true }
      ])
    })
  })

  it('keeps the count at one when the same actor reacts twice with the same name', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'react',
        published: true
      })
      await database.addAnnouncementReaction({
        announcementId: created.id,
        actorId: ACTOR1_ID,
        name: 'tada'
      })
      await database.addAnnouncementReaction({
        announcementId: created.id,
        actorId: ACTOR1_ID,
        name: 'tada'
      })

      const rollups = await database.getAnnouncementReactions({
        announcementIds: [created.id],
        actorId: ACTOR1_ID
      })
      expect(rollups).toEqual([
        { announcementId: created.id, name: 'tada', count: 1, me: true }
      ])
    })
  })
})

describe('announcement reaction ceiling', () => {
  it('refuses a new distinct name past the ceiling but admits a known one', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'react',
        published: true
      })
      const names = Array.from(
        { length: MAX_ANNOUNCEMENT_REACTION_NAMES },
        (_, index) => `name${index}`
      )
      for (const name of names) {
        expect(
          await database.addAnnouncementReaction({
            announcementId: created.id,
            actorId: ACTOR1_ID,
            name
          })
        ).toBeTrue()
      }

      // A ninth distinct name is refused, whoever asks.
      expect(
        await database.addAnnouncementReaction({
          announcementId: created.id,
          actorId: ACTOR2_ID,
          name: 'overflow'
        })
      ).toBeFalse()
      // A name already on the announcement adds no group, so another actor may
      // still join it.
      expect(
        await database.addAnnouncementReaction({
          announcementId: created.id,
          actorId: ACTOR2_ID,
          name: names[0]
        })
      ).toBeTrue()

      const rollups = await database.getAnnouncementReactions({
        announcementIds: [created.id],
        actorId: ACTOR1_ID
      })
      expect(rollups.map((rollup) => rollup.name).sort()).toEqual(
        [...names].sort()
      )
      expect(rollups.find((rollup) => rollup.name === names[0])?.count).toBe(2)
    })
  })

  it('counts the ceiling per announcement', async () => {
    await withFreshDatabase(async (database) => {
      const first = await database.createAnnouncement({
        text: 'first',
        published: true
      })
      const second = await database.createAnnouncement({
        text: 'second',
        published: true
      })
      for (let index = 0; index < MAX_ANNOUNCEMENT_REACTION_NAMES; index++) {
        await database.addAnnouncementReaction({
          announcementId: first.id,
          actorId: ACTOR1_ID,
          name: `name${index}`
        })
      }

      expect(
        await database.addAnnouncementReaction({
          announcementId: second.id,
          actorId: ACTOR1_ID,
          name: 'overflow'
        })
      ).toBeTrue()
    })
  })
})

describe('deleteAnnouncement', () => {
  it('removes the announcement along with its reads and reactions', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({
        text: 'delete me',
        published: true
      })
      await database.markAnnouncementRead({
        announcementId: created.id,
        actorId: ACTOR1_ID
      })
      await database.addAnnouncementReaction({
        announcementId: created.id,
        actorId: ACTOR1_ID,
        name: 'tada'
      })

      await database.deleteAnnouncement({ id: created.id })

      expect(await database.getAnnouncements()).toEqual([])
      expect(
        await database.getAnnouncementReadIds({
          actorId: ACTOR1_ID,
          announcementIds: [created.id]
        })
      ).toEqual([])
      expect(
        await database.getAnnouncementReactions({
          announcementIds: [created.id],
          actorId: ACTOR1_ID
        })
      ).toEqual([])
    })
  })
})

describe('active window boundaries', () => {
  it('includes an announcement whose window starts and ends exactly now', async () => {
    await withFreshDatabase(async (database) => {
      const now = Date.now()
      const created = await database.createAnnouncement({
        text: 'edges',
        published: true,
        startsAt: now,
        endsAt: now
      })

      const active = await database.getActiveAnnouncements({ now })
      expect(active.map((announcement) => announcement.id)).toEqual([
        created.id
      ])
    })
  })
})

// Each query must touch only the row it is asked about, so these seed a
// neighbouring announcement (or actor, or name) alongside.
describe('announcement queries only touch their own rows', () => {
  it('reads and updates one announcement among several', async () => {
    await withFreshDatabase(async (database) => {
      const first = await database.createAnnouncement({ text: 'first' })
      const second = await database.createAnnouncement({ text: 'second' })

      expect((await database.getAnnouncement({ id: second.id }))?.text).toBe(
        'second'
      )
      const updated = await database.updateAnnouncement({
        id: second.id,
        text: 'second changed',
        published: true
      })

      expect(updated).toMatchObject({
        id: second.id,
        text: 'second changed',
        published: true
      })
      expect(await database.getAnnouncement({ id: first.id })).toEqual(first)
    })
  })

  it('returns null when the announcement is deleted between the read and the update', async () => {
    await withFreshDatabase(async (database, testDb) => {
      const created = await database.createAnnouncement({ text: 'gone' })
      const [row] = await testDb.db
        .selectFrom('announcements')
        .selectAll()
        .execute()
      await database.deleteAnnouncement({ id: created.id })
      // The first read still sees the row, as if the delete landed just after.
      const racing = withStaleFirstRead(testDb.db, 'announcements', () => [row])

      await expect(
        announcementQueries.updateAnnouncement(racing, {
          id: created.id,
          text: 'late'
        })
      ).resolves.toBeNull()
    })
  })

  it('leaves publishedAt alone when the announcement is already published', async () => {
    await withFreshDatabase(async (database, testDb) => {
      // Published without ever being stamped, e.g. a row written by hand.
      const now = new Date()
      await testDb.db
        .insertInto('announcements')
        .values({
          id: 'unstamped',
          text: 'unstamped',
          published: true,
          createdAt: now,
          updatedAt: now
        })
        .execute()

      const updated = await database.updateAnnouncement({
        id: 'unstamped',
        published: true
      })

      expect(updated?.publishedAt).toBeNull()
    })
  })

  it('deletes one announcement with its own reads and reactions only', async () => {
    await withFreshDatabase(async (database) => {
      const kept = await database.createAnnouncement({ text: 'kept' })
      const removed = await database.createAnnouncement({ text: 'removed' })
      for (const { id } of [kept, removed]) {
        await database.markAnnouncementRead({
          announcementId: id,
          actorId: ACTOR1_ID
        })
        await database.addAnnouncementReaction({
          announcementId: id,
          actorId: ACTOR1_ID,
          name: 'tada'
        })
      }

      await database.deleteAnnouncement({ id: removed.id })

      expect((await database.getAnnouncements()).map(({ id }) => id)).toEqual([
        kept.id
      ])
      expect(
        await database.getAnnouncementReadIds({
          actorId: ACTOR1_ID,
          announcementIds: [kept.id, removed.id]
        })
      ).toEqual([kept.id])
      expect(
        await database.getAnnouncementReactions({
          announcementIds: [kept.id, removed.id],
          actorId: ACTOR1_ID
        })
      ).toEqual([{ announcementId: kept.id, name: 'tada', count: 1, me: true }])
    })
  })

  it('answers an empty list of announcements with nothing', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createAnnouncement({ text: 'read' })
      await database.markAnnouncementRead({
        announcementId: created.id,
        actorId: ACTOR1_ID
      })

      expect(
        await database.getAnnouncementReadIds({
          actorId: ACTOR1_ID,
          announcementIds: []
        })
      ).toEqual([])
      expect(
        await database.getAnnouncementReactions({
          announcementIds: [],
          actorId: ACTOR1_ID
        })
      ).toEqual([])
    })
  })

  it('lists the read ids of the requested announcements only', async () => {
    await withFreshDatabase(async (database) => {
      const first = await database.createAnnouncement({ text: 'first' })
      const second = await database.createAnnouncement({ text: 'second' })
      for (const { id } of [first, second]) {
        await database.markAnnouncementRead({
          announcementId: id,
          actorId: ACTOR1_ID
        })
      }

      expect(
        await database.getAnnouncementReadIds({
          actorId: ACTOR1_ID,
          announcementIds: [second.id]
        })
      ).toEqual([second.id])
    })
  })

  it('removes only the named reaction of the given actor on the given announcement', async () => {
    await withFreshDatabase(async (database) => {
      const target = await database.createAnnouncement({ text: 'target' })
      const other = await database.createAnnouncement({ text: 'other' })
      const react = (announcementId: string, actorId: string, name: string) =>
        database.addAnnouncementReaction({ announcementId, actorId, name })
      await react(target.id, ACTOR1_ID, 'tada')
      await react(target.id, ACTOR2_ID, 'tada')
      await react(target.id, ACTOR1_ID, 'party')
      await react(other.id, ACTOR1_ID, 'tada')

      await database.removeAnnouncementReaction({
        announcementId: target.id,
        actorId: ACTOR1_ID,
        name: 'tada'
      })

      const rollup = (announcementId: string) =>
        database.getAnnouncementReactions({
          announcementIds: [announcementId],
          actorId: ACTOR1_ID
        })
      expect(await rollup(target.id)).toEqual([
        { announcementId: target.id, name: 'party', count: 1, me: true },
        { announcementId: target.id, name: 'tada', count: 1, me: false }
      ])
      expect(await rollup(other.id)).toEqual([
        { announcementId: other.id, name: 'tada', count: 1, me: true }
      ])
    })
  })

  it('rolls up reactions per announcement and name, only for the requested announcements', async () => {
    await withFreshDatabase(async (database) => {
      const first = await database.createAnnouncement({ text: 'first' })
      const second = await database.createAnnouncement({ text: 'second' })
      const unrequested = await database.createAnnouncement({ text: 'other' })
      const [low, high] = [first.id, second.id].sort()
      const react = (announcementId: string, actorId: string, name: string) =>
        database.addAnnouncementReaction({ announcementId, actorId, name })
      // Added in the reverse of the order they are returned in.
      await react(high, ACTOR2_ID, 'b')
      await react(high, ACTOR1_ID, 'b')
      await react(high, ACTOR2_ID, 'a')
      await react(low, ACTOR1_ID, 'z')
      await react(unrequested.id, ACTOR1_ID, 'c')

      expect(
        await database.getAnnouncementReactions({
          announcementIds: [high, low],
          actorId: ACTOR1_ID
        })
      ).toEqual([
        { announcementId: low, name: 'z', count: 1, me: true },
        { announcementId: high, name: 'a', count: 1, me: false },
        { announcementId: high, name: 'b', count: 2, me: true }
      ])
    })
  })

  it('counts a name against the ceiling of its own announcement', async () => {
    await withFreshDatabase(async (database) => {
      const full = await database.createAnnouncement({ text: 'full' })
      const other = await database.createAnnouncement({ text: 'other' })
      for (let index = 0; index < MAX_ANNOUNCEMENT_REACTION_NAMES; index++) {
        await database.addAnnouncementReaction({
          announcementId: full.id,
          actorId: ACTOR1_ID,
          name: `name${index}`
        })
      }
      // The same name on another announcement does not make it a known name
      // of the full one.
      await database.addAnnouncementReaction({
        announcementId: other.id,
        actorId: ACTOR1_ID,
        name: 'elsewhere'
      })

      expect(
        await database.addAnnouncementReaction({
          announcementId: full.id,
          actorId: ACTOR2_ID,
          name: 'elsewhere'
        })
      ).toBeFalse()
    })
  })

  it('row-locks the announcement row before counting its reactions', async () => {
    await withFreshDatabase(async (database, testDb) => {
      const created = await database.createAnnouncement({
        text: 'locked',
        published: true
      })
      // The lock is what holds the reaction ceiling under concurrent requests
      // on PostgreSQL. SQLite has no row locks, so read the statements sent.
      const statements: string[] = []
      const record = ({ sql }: { sql: string }) => statements.push(sql)
      testDb.knex.on('query', record)
      try {
        await database.addAnnouncementReaction({
          announcementId: created.id,
          actorId: ACTOR1_ID,
          name: 'tada'
        })
      } finally {
        testDb.knex.removeListener('query', record)
      }

      const locking = statements.filter((sql) => /\bfor update\b/i.test(sql))
      if (testDb.backend === 'pg') {
        // This announcement's row only, locked before its reactions are read:
        // a lock taken after the count lets two requests both see seven names.
        expect(locking).toEqual([
          'select "id" from "announcements" where "id" = $1 for update'
        ])
        expect(statements.indexOf(locking[0])).toBeLessThan(
          statements.findIndex((sql) =>
            sql.includes('"announcement_reactions"')
          )
        )
      } else {
        expect(locking).toEqual([])
      }
    })
  })
})

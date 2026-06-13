import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'

const ACTOR1_ID = 'https://announcements.test/users/actor1'
const ACTOR2_ID = 'https://announcements.test/users/actor2'

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

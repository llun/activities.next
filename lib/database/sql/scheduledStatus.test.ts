import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { ScheduledStatusParams } from '@/lib/types/mastodon/scheduledStatus'

const ACTOR_ID = 'https://llun.test/users/owner'
const OTHER_ACTOR_ID = 'https://llun.test/users/other'

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

const baseParams = (
  overrides: Partial<ScheduledStatusParams> = {}
): ScheduledStatusParams => ({
  text: 'Scheduled post',
  poll: null,
  media_ids: null,
  sensitive: null,
  spoiler_text: null,
  visibility: 'public',
  in_reply_to_id: null,
  language: null,
  application_id: null,
  scheduled_at: null,
  idempotency: null,
  with_rate_limit: false,
  ...overrides
})

describe('ScheduledStatusDatabase', () => {
  it('creates a scheduled status and reads it back with parsed params', async () => {
    await withFreshDatabase(async (database) => {
      const scheduledAt = Date.now() + 3_600_000
      const created = await database.createScheduledStatus({
        actorId: ACTOR_ID,
        scheduledAt,
        params: baseParams({ text: 'Hello future', visibility: 'unlisted' })
      })

      expect(created.id).toBeTruthy()
      expect(created.actorId).toBe(ACTOR_ID)
      expect(created.scheduledAt).toBe(scheduledAt)
      expect(created.params.text).toBe('Hello future')
      expect(created.params.visibility).toBe('unlisted')
      expect(typeof created.createdAt).toBe('number')
      expect(typeof created.updatedAt).toBe('number')

      const fetched = await database.getScheduledStatus({
        actorId: ACTOR_ID,
        id: created.id
      })
      expect(fetched).not.toBeNull()
      expect(fetched?.id).toBe(created.id)
      expect(fetched?.scheduledAt).toBe(scheduledAt)
      expect(fetched?.params.text).toBe('Hello future')
      expect(fetched?.params.visibility).toBe('unlisted')
    })
  })

  it('reads a scheduled status by id without an actor scope', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createScheduledStatus({
        actorId: ACTOR_ID,
        scheduledAt: Date.now() + 1_000_000,
        params: baseParams({ text: 'By id' })
      })

      const fetched = await database.getScheduledStatusById({ id: created.id })
      expect(fetched).not.toBeNull()
      expect(fetched?.id).toBe(created.id)
      expect(fetched?.actorId).toBe(ACTOR_ID)
      expect(fetched?.params.text).toBe('By id')

      const missing = await database.getScheduledStatusById({
        id: 'does-not-exist'
      })
      expect(missing).toBeNull()
    })
  })

  it('lists scheduled statuses for an actor', async () => {
    await withFreshDatabase(async (database) => {
      const first = await database.createScheduledStatus({
        actorId: ACTOR_ID,
        scheduledAt: Date.now() + 1_000_000,
        params: baseParams({ text: 'First' })
      })
      const second = await database.createScheduledStatus({
        actorId: ACTOR_ID,
        scheduledAt: Date.now() + 2_000_000,
        params: baseParams({ text: 'Second' })
      })
      await database.createScheduledStatus({
        actorId: OTHER_ACTOR_ID,
        scheduledAt: Date.now() + 3_000_000,
        params: baseParams({ text: 'Other actor' })
      })

      const list = await database.getScheduledStatuses({
        actorId: ACTOR_ID,
        limit: 20
      })
      const ids = list.map((row) => row.id)
      expect(ids).toContain(first.id)
      expect(ids).toContain(second.id)
      expect(list).toHaveLength(2)
      expect(list.every((row) => row.actorId === ACTOR_ID)).toBe(true)
    })
  })

  it('paginates chronologically with max_id, since_id and min_id cursors', async () => {
    await withFreshDatabase(async (database) => {
      // Strictly increasing scheduledAt so ordering is deterministic and
      // independent of the random UUID ids.
      const created = []
      for (let i = 0; i < 3; i++) {
        created.push(
          await database.createScheduledStatus({
            actorId: ACTOR_ID,
            scheduledAt: Date.now() + (i + 1) * 1_000_000,
            params: baseParams({ text: `Page ${i}` })
          })
        )
      }
      const [earliest, middleRow, latest] = created

      // Default order is scheduledAt descending (latest scheduled first), NOT
      // shuffled by UUID id.
      const all = await database.getScheduledStatuses({
        actorId: ACTOR_ID,
        limit: 20
      })
      expect(all.map((row) => row.id)).toEqual([
        latest.id,
        middleRow.id,
        earliest.id
      ])

      // max_id: rows scheduled before the cursor, descending.
      const older = await database.getScheduledStatuses({
        actorId: ACTOR_ID,
        limit: 20,
        maxId: middleRow.id
      })
      expect(older.map((row) => row.id)).toEqual([earliest.id])

      // since_id: rows scheduled after the cursor, descending.
      const newerSince = await database.getScheduledStatuses({
        actorId: ACTOR_ID,
        limit: 20,
        sinceId: middleRow.id
      })
      expect(newerSince.map((row) => row.id)).toEqual([latest.id])

      // min_id: rows scheduled after the cursor, ascending (reversed).
      const newerMin = await database.getScheduledStatuses({
        actorId: ACTOR_ID,
        limit: 20,
        minId: middleRow.id
      })
      expect(newerMin.map((row) => row.id)).toEqual([latest.id])
    })
  })

  it('updates the scheduled time and reflects it on read', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createScheduledStatus({
        actorId: ACTOR_ID,
        scheduledAt: Date.now() + 1_000_000,
        params: baseParams()
      })
      const newScheduledAt = Date.now() + 5_000_000

      const updated = await database.updateScheduledStatusAt({
        actorId: ACTOR_ID,
        id: created.id,
        scheduledAt: newScheduledAt
      })
      expect(updated).not.toBeNull()
      expect(updated?.scheduledAt).toBe(newScheduledAt)

      const fetched = await database.getScheduledStatus({
        actorId: ACTOR_ID,
        id: created.id
      })
      expect(fetched?.scheduledAt).toBe(newScheduledAt)
    })
  })

  it('returns an empty page when the pagination cursor no longer exists', async () => {
    await withFreshDatabase(async (database) => {
      await database.createScheduledStatus({
        actorId: ACTOR_ID,
        scheduledAt: Date.now() + 1_000_000,
        params: baseParams({ text: 'Still here' })
      })

      // A cursor pointing at a deleted/published row must not fall back to the
      // first page (which would loop the client over duplicates).
      const olderPage = await database.getScheduledStatuses({
        actorId: ACTOR_ID,
        limit: 20,
        maxId: 'cursor-that-was-deleted'
      })
      expect(olderPage).toEqual([])

      const newerPage = await database.getScheduledStatuses({
        actorId: ACTOR_ID,
        limit: 20,
        sinceId: 'cursor-that-was-deleted'
      })
      expect(newerPage).toEqual([])
    })
  })

  it('returns the row (not null) when rescheduling to the same time', async () => {
    await withFreshDatabase(async (database) => {
      const scheduledAt = Date.now() + 1_000_000
      const created = await database.createScheduledStatus({
        actorId: ACTOR_ID,
        scheduledAt,
        params: baseParams()
      })

      // SQLite reports 0 changed rows for a no-op update; the method must still
      // return the existing row rather than a false null (which would 404).
      const updated = await database.updateScheduledStatusAt({
        actorId: ACTOR_ID,
        id: created.id,
        scheduledAt
      })
      expect(updated).not.toBeNull()
      expect(updated?.id).toBe(created.id)
      expect(updated?.scheduledAt).toBe(scheduledAt)
    })
  })

  it('scopes get, update and delete to the owning actor', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createScheduledStatus({
        actorId: ACTOR_ID,
        scheduledAt: Date.now() + 1_000_000,
        params: baseParams()
      })

      const fetchedAsOther = await database.getScheduledStatus({
        actorId: OTHER_ACTOR_ID,
        id: created.id
      })
      expect(fetchedAsOther).toBeNull()

      const updatedAsOther = await database.updateScheduledStatusAt({
        actorId: OTHER_ACTOR_ID,
        id: created.id,
        scheduledAt: Date.now() + 9_000_000
      })
      expect(updatedAsOther).toBeNull()

      const deletedAsOther = await database.deleteScheduledStatus({
        actorId: OTHER_ACTOR_ID,
        id: created.id
      })
      expect(deletedAsOther).toBe(false)

      // Still present for the real owner after the failed cross-actor delete.
      const stillThere = await database.getScheduledStatus({
        actorId: ACTOR_ID,
        id: created.id
      })
      expect(stillThere).not.toBeNull()
    })
  })

  it('deletes a scheduled status so it can no longer be read', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createScheduledStatus({
        actorId: ACTOR_ID,
        scheduledAt: Date.now() + 1_000_000,
        params: baseParams()
      })

      const deleted = await database.deleteScheduledStatus({
        actorId: ACTOR_ID,
        id: created.id
      })
      expect(deleted).toBe(true)

      const fetched = await database.getScheduledStatus({
        actorId: ACTOR_ID,
        id: created.id
      })
      expect(fetched).toBeNull()
    })
  })

  describe('getDueScheduledStatuses', () => {
    const CUTOFF = 1_700_000_000_000

    it.each([
      {
        description: 'includes a status scheduled before the cutoff',
        scheduledAt: CUTOFF - 1_000,
        due: true
      },
      {
        description: 'includes a status scheduled exactly at the cutoff',
        scheduledAt: CUTOFF,
        due: true
      },
      {
        description: 'excludes a status scheduled after the cutoff',
        scheduledAt: CUTOFF + 1_000,
        due: false
      }
    ])('$description', async ({ scheduledAt, due }) => {
      await withFreshDatabase(async (database) => {
        const created = await database.createScheduledStatus({
          actorId: ACTOR_ID,
          scheduledAt,
          params: baseParams()
        })

        const dueRows = await database.getDueScheduledStatuses({
          before: CUTOFF
        })
        const ids = dueRows.map((row) => row.id)
        expect(ids.includes(created.id)).toBe(due)
      })
    })

    it('returns due rows across all actors', async () => {
      await withFreshDatabase(async (database) => {
        const ownerRow = await database.createScheduledStatus({
          actorId: ACTOR_ID,
          scheduledAt: CUTOFF - 5_000,
          params: baseParams()
        })
        const otherRow = await database.createScheduledStatus({
          actorId: OTHER_ACTOR_ID,
          scheduledAt: CUTOFF - 5_000,
          params: baseParams()
        })

        const dueRows = await database.getDueScheduledStatuses({
          before: CUTOFF
        })
        const ids = dueRows.map((row) => row.id)
        expect(ids).toContain(ownerRow.id)
        expect(ids).toContain(otherRow.id)
      })
    })

    it('caps the result set to the optional limit, soonest first', async () => {
      await withFreshDatabase(async (database) => {
        const earliest = await database.createScheduledStatus({
          actorId: ACTOR_ID,
          scheduledAt: CUTOFF - 30_000,
          params: baseParams()
        })
        await database.createScheduledStatus({
          actorId: ACTOR_ID,
          scheduledAt: CUTOFF - 20_000,
          params: baseParams()
        })
        await database.createScheduledStatus({
          actorId: ACTOR_ID,
          scheduledAt: CUTOFF - 10_000,
          params: baseParams()
        })

        const dueRows = await database.getDueScheduledStatuses({
          before: CUTOFF,
          limit: 2
        })
        expect(dueRows).toHaveLength(2)
        // Ordered by scheduledAt ascending, so the earliest is included first.
        expect(dueRows[0].id).toBe(earliest.id)
      })
    })
  })
})

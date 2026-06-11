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
  })
})

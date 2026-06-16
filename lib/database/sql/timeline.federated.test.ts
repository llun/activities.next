import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { Timeline } from '@/lib/services/timelines/types'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { waitFor } from '@/lib/utils/waitFor'

const REMOTE = 'https://remote.example/users/relayed'

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

const seedFederatedStatus = async (database: Database, n: number) => {
  const id = `${REMOTE}/statuses/relayed-${n}`
  const status = await database.createNote({
    id,
    url: id,
    actorId: REMOTE,
    text: `Relayed status ${n}`,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: []
  })
  await database.addStatusToFederatedTimeline({
    statusId: status.id,
    statusActorId: REMOTE
  })
  return status
}

describe('Timeline.FEDERATED_PUBLIC', () => {
  it('returns only statuses added to the federated timeline, newest first', async () => {
    await withFreshDatabase(async (database) => {
      for (let n = 1; n <= 3; n++) {
        await seedFederatedStatus(database, n)
        await waitFor(5)
      }

      // A remote status that was stored but NOT added to the federated timeline
      // (e.g. fetched for thread context) must not appear.
      const notFederatedId = `${REMOTE}/statuses/not-federated`
      await database.createNote({
        id: notFederatedId,
        url: notFederatedId,
        actorId: REMOTE,
        text: 'Not in the federated feed',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const statuses = await database.getTimeline({
        timeline: Timeline.FEDERATED_PUBLIC
      })

      expect(statuses.map((status) => status.id)).toEqual([
        `${REMOTE}/statuses/relayed-3`,
        `${REMOTE}/statuses/relayed-2`,
        `${REMOTE}/statuses/relayed-1`
      ])
    })
  })

  it('is idempotent — adding the same status twice yields one entry', async () => {
    await withFreshDatabase(async (database) => {
      const status = await seedFederatedStatus(database, 1)
      await database.addStatusToFederatedTimeline({
        statusId: status.id,
        statusActorId: REMOTE
      })

      const statuses = await database.getTimeline({
        timeline: Timeline.FEDERATED_PUBLIC
      })
      expect(statuses).toHaveLength(1)
    })
  })

  it('paginates with maxStatusId without repeating', async () => {
    await withFreshDatabase(async (database) => {
      for (let n = 1; n <= 3; n++) {
        await seedFederatedStatus(database, n)
        await waitFor(5)
      }

      const firstPage = await database.getTimeline({
        timeline: Timeline.FEDERATED_PUBLIC,
        limit: 2
      })
      expect(firstPage.map((status) => status.id)).toEqual([
        `${REMOTE}/statuses/relayed-3`,
        `${REMOTE}/statuses/relayed-2`
      ])

      const secondPage = await database.getTimeline({
        timeline: Timeline.FEDERATED_PUBLIC,
        maxStatusId: firstPage[firstPage.length - 1].id,
        limit: 2
      })
      expect(secondPage.map((status) => status.id)).toEqual([
        `${REMOTE}/statuses/relayed-1`
      ])
    })
  })

  it('returns an empty list when nothing has been federated', async () => {
    await withFreshDatabase(async (database) => {
      expect(
        await database.getTimeline({ timeline: Timeline.FEDERATED_PUBLIC })
      ).toEqual([])
    })
  })
})

import { countableActivity } from '@/lib/database/kysely/countableActivity'
import { applyCountableActivityFilter } from '@/lib/database/sql/utils/countableActivity'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

// The Kysely countable-activity predicate must select exactly the rows its Knex
// original selects while both are in use: the Knex one still serves the
// unported route queries. Both run over the same rows, for
// both forms of the predicate, and the id sets are compared; the named cases
// say which rule broke.
describe('countableActivity matches applyCountableActivityFilter', () => {
  const testDb = createTestDatabase()
  const { database, knex } = testDb

  const actorId = 'https://countable.test/users/rider'
  const otherActorId = 'https://countable.test/users/other'
  const statusIds = ['ride-1', 'ride-2'].map(
    (key) => `${actorId}/statuses/${key}`
  )
  const otherStatusId = `${otherActorId}/statuses/ride-3`

  type Row = {
    id: string
    actorId?: string
    statusId: string | null
    deviceGearId: string | null
    isPrimary: boolean
    processingStatus: string | null
    deleted?: boolean
  }

  const insert = async (rows: Row[]) => {
    const now = new Date('2026-05-01T08:00:00.000Z')
    await testDb.db
      .insertInto('fitness_files')
      .values(
        rows.map((row) => ({
          id: row.id,
          actorId: row.actorId ?? actorId,
          statusId: row.statusId,
          deviceGearId: row.deviceGearId,
          isPrimary: row.isPrimary,
          processingStatus: row.processingStatus,
          deletedAt: row.deleted ? now : null,
          path: `fitness/${row.id}.fit`,
          fileName: `${row.id}.fit`,
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1,
          createdAt: now,
          updatedAt: now
        }))
      )
      .execute()
  }

  const byKnex = async (forDeviceLink: boolean, prefix: string) => {
    const query = applyCountableActivityFilter(
      knex,
      knex('fitness_files'),
      'fitness_files',
      { forDeviceLink }
    )
      .where('fitness_files.id', 'like', `${prefix}%`)
      .select('fitness_files.id')
    return ((await query) as { id: string }[]).map(({ id }) => id).sort()
  }

  const byKysely = async (forDeviceLink: boolean, prefix: string) => {
    const rows = await testDb.db
      .selectFrom('fitness_files')
      .select('fitness_files.id')
      .where((eb) => countableActivity(eb, { forDeviceLink }))
      .where('fitness_files.id', 'like', `${prefix}%`)
      .execute()
    return rows.map(({ id }) => id).sort()
  }

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    for (const id of [actorId, otherActorId]) {
      const [, , domain, , username] = id.split('/')
      await database.createActor({
        actorId: id,
        username,
        domain,
        publicKey: `public-${username}`,
        privateKey: `private-${username}`,
        inboxUrl: `${id}/inbox`,
        sharedInboxUrl: `https://${domain}/inbox`,
        followersUrl: `${id}/followers`,
        createdAt: Date.now()
      })
    }
    for (const [id, owner] of [
      ...statusIds.map((id) => [id, actorId]),
      [otherStatusId, otherActorId]
    ]) {
      await database.createNote({
        id,
        url: id,
        actorId: owner,
        text: 'ride',
        to: [],
        cc: []
      })
    }
  })

  afterAll(async () => {
    await database.destroy()
  })

  // Every combination of the columns the predicate reads, twice over, with the
  // ids shuffled so "lowest id" falls on a different shape in every group.
  it('selects the same rows over every combination of the columns it reads', async () => {
    const rows: Row[] = []
    const shapes: Omit<Row, 'id'>[] = []
    for (const deleted of [false, true])
      for (const processingStatus of ['completed', 'pending', 'failed', null])
        for (const isPrimary of [true, false])
          for (const statusId of [null, ...statusIds])
            for (const deviceGearId of [null, 'device-a', 'device-b'])
              for (const copy of [0, 1])
                shapes.push({
                  deleted,
                  processingStatus,
                  isPrimary,
                  statusId,
                  deviceGearId,
                  // The second copy belongs to another actor for one status,
                  // which the predicate does not look at either.
                  ...(copy === 1 && statusId === null
                    ? { actorId: otherActorId }
                    : {})
                })
    // A fixed permutation (multiplicative stride) rather than a random one, so
    // a failure names the same rows on every run.
    const stride = 97
    shapes.forEach((shape, index) => {
      const position = (index * stride) % shapes.length
      rows.push({ id: `all-${String(position).padStart(4, '0')}`, ...shape })
    })
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
    await insert(rows)

    for (const forDeviceLink of [false, true]) {
      const knexIds = await byKnex(forDeviceLink, 'all-')
      const kyselyIds = await byKysely(forDeviceLink, 'all-')
      expect(kyselyIds).toEqual(knexIds)
      // Neither everything nor nothing, so the comparison says something.
      expect(knexIds.length).toBeGreaterThan(0)
      expect(knexIds.length).toBeLessThan(rows.length)
    }
  })

  describe.each([false, true])('forDeviceLink %s', (forDeviceLink) => {
    const check = async (prefix: string, rows: Row[], expected: string[]) => {
      // Device ids are prefixed too: the sibling check looks at every row of
      // the table, so one case must not see another case's files.
      await insert(
        rows.map((row) => ({
          ...row,
          id: `${prefix}${row.id}`,
          deviceGearId: row.deviceGearId && `${prefix}${row.deviceGearId}`
        }))
      )
      const knexIds = await byKnex(forDeviceLink, prefix)
      const kyselyIds = await byKysely(forDeviceLink, prefix)
      expect(kyselyIds).toEqual(knexIds)
      expect(kyselyIds).toEqual(expected.map((id) => `${prefix}${id}`).sort())
    }
    const tag = forDeviceLink ? 'd' : 'p'

    it('drops deleted and unfinished files', async () => {
      await check(
        `${tag}-done-`,
        [
          {
            id: 'kept',
            statusId: null,
            deviceGearId: null,
            isPrimary: true,
            processingStatus: 'completed'
          },
          {
            id: 'deleted',
            statusId: null,
            deviceGearId: null,
            isPrimary: true,
            processingStatus: 'completed',
            deleted: true
          },
          {
            id: 'pending',
            statusId: null,
            deviceGearId: null,
            isPrimary: true,
            processingStatus: 'pending'
          },
          {
            id: 'unset',
            statusId: null,
            deviceGearId: null,
            isPrimary: true,
            processingStatus: null
          }
        ],
        ['kept']
      )
    })

    it('keeps one file per post and device', async () => {
      // One device, one post: a primary and two secondaries. Without the device
      // link only the primary counts; with it the primary still wins.
      // Another device on the same post has only secondaries: the lowest id
      // wins there. A third secondary on a post of its own always counts.
      await check(
        `${tag}-ride-`,
        [
          {
            id: 'a-primary',
            statusId: statusIds[0],
            deviceGearId: 'device-a',
            isPrimary: true,
            processingStatus: 'completed'
          },
          {
            id: 'a-secondary-1',
            statusId: statusIds[0],
            deviceGearId: 'device-a',
            isPrimary: false,
            processingStatus: 'completed'
          },
          {
            id: 'b-secondary-1',
            statusId: statusIds[0],
            deviceGearId: 'device-b',
            isPrimary: false,
            processingStatus: 'completed'
          },
          {
            id: 'b-secondary-2',
            statusId: statusIds[0],
            deviceGearId: 'device-b',
            isPrimary: false,
            processingStatus: 'completed'
          },
          {
            id: 'c-alone',
            statusId: statusIds[1],
            deviceGearId: 'device-a',
            isPrimary: false,
            processingStatus: 'completed'
          }
        ],
        forDeviceLink
          ? ['a-primary', 'b-secondary-1', 'c-alone']
          : ['a-primary']
      )
    })

    it('lets the primary win over a secondary with a lower id', async () => {
      // The id tie-break applies only between files of the same kind.
      await check(
        `${tag}-order-`,
        [
          {
            id: 'a-secondary',
            statusId: statusIds[0],
            deviceGearId: 'device-a',
            isPrimary: false,
            processingStatus: 'completed'
          },
          {
            id: 'b-primary',
            statusId: statusIds[0],
            deviceGearId: 'device-a',
            isPrimary: true,
            processingStatus: 'completed'
          }
        ],
        ['b-primary']
      )
    })

    it('never defers to a sibling that does not count itself', async () => {
      // The primary is still processing and a lower-id secondary is deleted:
      // the remaining secondary is the one that speaks for the device.
      await check(
        `${tag}-defer-`,
        [
          {
            id: 'a-primary',
            statusId: statusIds[1],
            deviceGearId: 'device-b',
            isPrimary: true,
            processingStatus: 'pending'
          },
          {
            id: 'b-deleted',
            statusId: statusIds[1],
            deviceGearId: 'device-b',
            isPrimary: false,
            processingStatus: 'completed',
            deleted: true
          },
          {
            id: 'c-secondary',
            statusId: statusIds[1],
            deviceGearId: 'device-b',
            isPrimary: false,
            processingStatus: 'completed'
          }
        ],
        forDeviceLink ? ['c-secondary'] : []
      )
    })

    it('counts every file with no post or no device on its own', async () => {
      await check(
        `${tag}-alone-`,
        [
          {
            id: 'a-no-post',
            statusId: null,
            deviceGearId: 'device-a',
            isPrimary: false,
            processingStatus: 'completed'
          },
          {
            id: 'b-no-post',
            statusId: null,
            deviceGearId: 'device-a',
            isPrimary: false,
            processingStatus: 'completed'
          },
          {
            id: 'c-no-device',
            statusId: otherStatusId,
            actorId: otherActorId,
            deviceGearId: null,
            isPrimary: false,
            processingStatus: 'completed'
          },
          {
            id: 'd-no-device',
            statusId: otherStatusId,
            actorId: otherActorId,
            deviceGearId: null,
            isPrimary: false,
            processingStatus: 'completed'
          }
        ],
        forDeviceLink
          ? ['a-no-post', 'b-no-post', 'c-no-device', 'd-no-device']
          : []
      )
    })
  })
})

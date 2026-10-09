import {
  createFreshDatabaseRunner,
  seedActorTestDatabase
} from '@/lib/database/sql/actorTestHelpers'
import {
  SQLITE_MAX_BINDINGS,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import {
  generatePublicId,
  getPublicIdTimestamp,
  isPublicId
} from '@/lib/utils/publicId'

describe('ActorDatabase publicId', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (backendName, database) => {
    const withFreshDatabase = createFreshDatabaseRunner(backendName)

    beforeAll(async () => {
      await seedActorTestDatabase(database)
    })

    describe('publicId', () => {
      it('mints a v7 publicId at createActor whose timestamp matches createdAt', async () => {
        await withFreshDatabase(async (freshDatabase) => {
          const actorId = `https://${TEST_DOMAIN}/users/public-id-create-actor`
          const createdAt = Date.UTC(2024, 0, 2, 3, 4, 5, 0)
          await freshDatabase.createActor({
            actorId,
            username: 'public-id-create-actor',
            domain: TEST_DOMAIN,
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            createdAt
          })

          const publicIds = await freshDatabase.getActorPublicIds({
            actorIds: [actorId]
          })
          const publicId = publicIds.get(actorId)

          expect(publicId).toBeTruthy()
          expect(isPublicId(publicId as string)).toBe(true)
          expect(getPublicIdTimestamp(publicId as string)).toBe(createdAt)
        })
      })

      it('round-trips getActorIdByPublicId and returns null for an id that was never stored', async () => {
        await withFreshDatabase(async (freshDatabase) => {
          const actorId = `https://${TEST_DOMAIN}/users/public-id-roundtrip`
          await freshDatabase.createActor({
            actorId,
            username: 'public-id-roundtrip',
            domain: TEST_DOMAIN,
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            createdAt: Date.now()
          })

          const publicIds = await freshDatabase.getActorPublicIds({
            actorIds: [actorId]
          })
          const publicId = publicIds.get(actorId) as string

          expect(await freshDatabase.getActorIdByPublicId({ publicId })).toBe(
            actorId
          )
          expect(
            await freshDatabase.getActorIdByPublicId({
              publicId: generatePublicId()
            })
          ).toBeNull()
        })
      })

      it('getActorIdsByPublicIds maps every known publicId back and omits unknown ones', async () => {
        await withFreshDatabase(async (freshDatabase) => {
          const firstId = `https://${TEST_DOMAIN}/users/public-ids-batch-1`
          const secondId = `https://${TEST_DOMAIN}/users/public-ids-batch-2`
          for (const [actorId, username] of [
            [firstId, 'public-ids-batch-1'],
            [secondId, 'public-ids-batch-2']
          ]) {
            await freshDatabase.createActor({
              actorId,
              username,
              domain: TEST_DOMAIN,
              followersUrl: `${actorId}/followers`,
              inboxUrl: `${actorId}/inbox`,
              sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
              publicKey: 'public-key',
              createdAt: Date.now()
            })
          }

          const publicIds = await freshDatabase.getActorPublicIds({
            actorIds: [firstId, secondId]
          })
          const unknownPublicId = generatePublicId()

          const map = await freshDatabase.getActorIdsByPublicIds({
            publicIds: [
              publicIds.get(firstId) as string,
              publicIds.get(secondId) as string,
              unknownPublicId
            ]
          })

          expect(map.size).toBe(2)
          expect(map.get(publicIds.get(firstId) as string)).toBe(firstId)
          expect(map.get(publicIds.get(secondId) as string)).toBe(secondId)
          expect(map.has(unknownPublicId)).toBe(false)
        })
      })

      it('getActorIdsByPublicIds returns an empty map for an empty request', async () => {
        await withFreshDatabase(async (freshDatabase) => {
          const map = await freshDatabase.getActorIdsByPublicIds({
            publicIds: []
          })
          expect(map.size).toBe(0)
        })
      })

      it('resolves an uppercased publicId and keys the batch map by the requested form', async () => {
        // publicIds are stored lowercase and SQLite/PostgreSQL compare them case
        // sensitively, so the case fold has to happen on the lookup PARAMETER —
        // in the database layer, where every resolution site shares it. The
        // batch map is keyed by what the caller asked with, not by what the row
        // holds, so a caller can zip it back against its own input.
        await withFreshDatabase(async (freshDatabase) => {
          const actorId = `https://${TEST_DOMAIN}/users/public-id-uppercase`
          await freshDatabase.createActor({
            actorId,
            username: 'public-id-uppercase',
            domain: TEST_DOMAIN,
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          const publicIds = await freshDatabase.getActorPublicIds({
            actorIds: [actorId]
          })
          const uppercasePublicId = (
            publicIds.get(actorId) as string
          ).toUpperCase()

          expect(
            await freshDatabase.getActorIdByPublicId({
              publicId: uppercasePublicId
            })
          ).toBe(actorId)

          const map = await freshDatabase.getActorIdsByPublicIds({
            publicIds: [uppercasePublicId]
          })
          expect(map.get(uppercasePublicId)).toBe(actorId)
        })
      })

      it('getActorPublicIds returns a map covering only requested ids that have publicIds', async () => {
        await withFreshDatabase(async (freshDatabase, instance) => {
          const withId = `https://${TEST_DOMAIN}/users/public-id-with`
          const withoutId = `https://${TEST_DOMAIN}/users/public-id-legacy-without`

          await freshDatabase.createActor({
            actorId: withId,
            username: 'public-id-with',
            domain: TEST_DOMAIN,
            followersUrl: `${withId}/followers`,
            inboxUrl: `${withId}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          await freshDatabase.createActor({
            actorId: withoutId,
            username: 'public-id-legacy-without',
            domain: TEST_DOMAIN,
            followersUrl: `${withoutId}/followers`,
            inboxUrl: `${withoutId}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          // Simulate a legacy row that predates the backfill migration.
          await instance('actors')
            .where('id', withoutId)
            .update({ publicId: null })

          const map = await freshDatabase.getActorPublicIds({
            actorIds: [
              withId,
              withoutId,
              `https://${TEST_DOMAIN}/users/public-id-missing`
            ]
          })

          expect(map.size).toBe(1)
          expect(map.has(withoutId)).toBe(false)
          expect(map.get(withId)).toBeTruthy()
        })
      })

      it('getActorPublicIds chunks a request wider than the SQLite bind limit', async () => {
        // A full timeline page can mention more actors than
        // SQLITE_MAX_BINDINGS allows in one statement, so the lookup has to
        // chunk like its getActorIdsByPublicIds counterpart does.
        await withFreshDatabase(async (freshDatabase, instance) => {
          const actorId = `https://${TEST_DOMAIN}/users/public-ids-chunked`
          await freshDatabase.createActor({
            actorId,
            username: 'public-ids-chunked',
            domain: TEST_DOMAIN,
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          const actorIds = [
            ...Array.from(
              { length: SQLITE_MAX_BINDINGS + 10 },
              (_unused, index) =>
                `https://${TEST_DOMAIN}/users/public-ids-chunk-missing-${index}`
            ),
            actorId
          ]
          const queries: { bindings: unknown[]; sql: string }[] = []
          const handleQuery = ({
            bindings,
            sql
          }: {
            bindings?: unknown[]
            sql: string
          }) => {
            queries.push({ bindings: bindings ?? [], sql: sql.toLowerCase() })
          }

          instance.on('query', handleQuery)
          const map = await freshDatabase.getActorPublicIds({ actorIds })
          instance.off('query', handleQuery)

          const bindingCounts = queries
            .filter(
              ({ sql }) =>
                /from [`"]actors[`"]/.test(sql) && /[`"]id[`"] in/.test(sql)
            )
            .map(({ bindings }) => bindings.length)
          expect(bindingCounts.length).toBeGreaterThan(1)
          expect(Math.max(...bindingCounts)).toBeLessThanOrEqual(
            getWhereInBatchSize(instance)
          )
          expect(map.size).toBe(1)
          expect(map.get(actorId)).toBeTruthy()
        })
      })

      it('getActorFromId returns an actor with a v7 publicId threaded from the row', async () => {
        await withFreshDatabase(async (freshDatabase) => {
          const actorId = `https://${TEST_DOMAIN}/users/public-id-threaded`
          await freshDatabase.createActor({
            actorId,
            username: 'public-id-threaded',
            domain: TEST_DOMAIN,
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            createdAt: Date.now()
          })

          const actor = await freshDatabase.getActorFromId({ id: actorId })

          expect(actor?.publicId).toBeTruthy()
          expect(isPublicId(actor?.publicId as string)).toBe(true)
        })
      })

      it('a status fetched with getStatus embeds the actor publicId', async () => {
        await withFreshDatabase(async (freshDatabase) => {
          const actorId = `https://${TEST_DOMAIN}/users/public-id-status-actor`
          await freshDatabase.createActor({
            actorId,
            username: 'public-id-status-actor',
            domain: TEST_DOMAIN,
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            createdAt: Date.now()
          })

          const statusId = `${actorId}/statuses/public-id-status`
          await freshDatabase.createNote({
            id: statusId,
            url: statusId,
            actorId,
            text: 'hello',
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: []
          })

          const status = await freshDatabase.getStatus({ statusId })

          expect(status?.actor?.publicId).toBeTruthy()
          expect(isPublicId(status?.actor?.publicId as string)).toBe(true)
        })
      })
    })
  })
})

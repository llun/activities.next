import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'

describe('FitnessFileRouteDataDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database)
    })

    afterAll(async () => {
      await database.destroy()
    })

    const createIsolatedActor = async (db: Database, username: string) => {
      const actorId = `https://llun.test/users/${username}`
      await db.createActor({
        actorId,
        username,
        domain: 'llun.test',
        inboxUrl: `${actorId}/inbox`,
        followersUrl: `${actorId}/followers`,
        sharedInboxUrl: 'https://llun.test/inbox',
        publicKey: `public-key-${username}`,
        privateKey: `private-key-${username}`,
        createdAt: Date.now()
      })
      return actorId
    }

    const createActivity = async (
      db: Database,
      {
        actorId,
        pathSuffix
      }: {
        actorId: string
        pathSuffix: string
      }
    ) => {
      const file = await db.createFitnessFile({
        actorId,
        path: `fitness/route-${pathSuffix}.fit`,
        fileName: `route-${pathSuffix}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024
      })
      return file!.id
    }

    describe('createFitnessFileRouteData and getFitnessFileRouteData', () => {
      it('creates and reads back pre-parsed route data', async () => {
        const actorId = await createIsolatedActor(database, 'route-user-1')
        const fitnessFileId = await createActivity(database, {
          actorId,
          pathSuffix: 'data-1'
        })

        const sampleGeoJson = JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [4.9, 52.3],
                  [4.91, 52.31]
                ]
              }
            }
          ]
        })

        const created = await database.createFitnessFileRouteData({
          fitnessFileId,
          actorId,
          routeData: sampleGeoJson,
          sourceVersion: 2
        })

        expect(created).toMatchObject({
          fitnessFileId,
          actorId,
          routeData: sampleGeoJson,
          sourceVersion: 2
        })
        expect(typeof created.createdAt).toBe('number')
        expect(typeof created.updatedAt).toBe('number')

        const fetched = await database.getFitnessFileRouteData({
          fitnessFileId
        })
        expect(fetched).toEqual(created)
      })

      it('defaults sourceVersion to 1 when omitted', async () => {
        const actorId = await createIsolatedActor(database, 'route-user-2')
        const fitnessFileId = await createActivity(database, {
          actorId,
          pathSuffix: 'data-2'
        })

        const created = await database.createFitnessFileRouteData({
          fitnessFileId,
          actorId,
          routeData: '{"streams":{"time":[0,1,2]}}'
        })

        expect(created.sourceVersion).toBe(1)

        const fetched = await database.getFitnessFileRouteData({
          fitnessFileId
        })
        expect(fetched?.sourceVersion).toBe(1)
      })

      it('upserts and updates existing record on conflict', async () => {
        const actorId = await createIsolatedActor(database, 'route-user-3')
        const fitnessFileId = await createActivity(database, {
          actorId,
          pathSuffix: 'data-3'
        })

        const first = await database.createFitnessFileRouteData({
          fitnessFileId,
          actorId,
          routeData: 'initial-data',
          sourceVersion: 1
        })

        expect(first.routeData).toBe('initial-data')

        const updated = await database.upsertFitnessFileRouteData({
          fitnessFileId,
          actorId,
          routeData: 'updated-data',
          sourceVersion: 2
        })

        expect(updated.routeData).toBe('updated-data')
        expect(updated.sourceVersion).toBe(2)

        const fetched = await database.getFitnessFileRouteData({
          fitnessFileId
        })
        expect(fetched?.routeData).toBe('updated-data')
        expect(fetched?.sourceVersion).toBe(2)
      })

      it('returns null when route data does not exist', async () => {
        const result = await database.getFitnessFileRouteData({
          fitnessFileId: 'non-existent-id'
        })
        expect(result).toBeNull()
      })
    })

    describe('deleteFitnessFileRouteData', () => {
      it('deletes route data and reports whether a row was deleted', async () => {
        const actorId = await createIsolatedActor(database, 'route-user-4')
        const fitnessFileId = await createActivity(database, {
          actorId,
          pathSuffix: 'data-4'
        })

        await database.createFitnessFileRouteData({
          fitnessFileId,
          actorId,
          routeData: 'to-be-deleted'
        })

        const deleted = await database.deleteFitnessFileRouteData({
          fitnessFileId
        })
        expect(deleted).toBe(true)

        const fetched = await database.getFitnessFileRouteData({
          fitnessFileId
        })
        expect(fetched).toBeNull()

        const deletedAgain = await database.deleteFitnessFileRouteData({
          fitnessFileId
        })
        expect(deletedAgain).toBe(false)
      })

      it('returns false when deleting non-existent route data', async () => {
        const deleted = await database.deleteFitnessFileRouteData({
          fitnessFileId: 'does-not-exist'
        })
        expect(deleted).toBe(false)
      })

      it('deletes cached route data when the parent fitness file is soft-deleted and rejects subsequent writes', async () => {
        const actorId = await createIsolatedActor(database, 'route-user-5')
        const fitnessFileId = await createActivity(database, {
          actorId,
          pathSuffix: 'data-5'
        })

        await database.createFitnessFileRouteData({
          fitnessFileId,
          actorId,
          routeData: '{"version":1}',
          sourceVersion: 1
        })

        const metadata = await database.getFitnessFileRouteDataMetadata({
          fitnessFileId
        })
        expect(metadata).toMatchObject({
          fitnessFileId,
          actorId,
          sourceVersion: 1
        })
        expect(metadata).not.toHaveProperty('routeData')

        expect(await database.deleteFitnessFile({ id: fitnessFileId })).toBe(
          true
        )

        expect(
          await database.getFitnessFileRouteData({ fitnessFileId })
        ).toBeNull()
        expect(
          await database.getFitnessFileRouteDataMetadata({ fitnessFileId })
        ).toBeNull()

        await expect(
          database.upsertFitnessFileRouteData({
            fitnessFileId,
            actorId,
            routeData: '{"version":1}'
          })
        ).rejects.toThrow(
          `Cannot cache route data for missing or deleted fitness file: ${fitnessFileId}`
        )
      })
    })
  })
})

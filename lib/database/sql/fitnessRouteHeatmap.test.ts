import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('FitnessRouteHeatmapDatabase', () => {
  const { actors } = DatabaseSeed
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

    describe('createFitnessRouteHeatmap / getFitnessRouteHeatmap', () => {
      it('creates and retrieves a route cache record', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2026',
          region: '',
          periodStart: new Date('2026-01-01T00:00:00Z'),
          periodEnd: new Date('2027-01-01T00:00:00Z')
        })

        expect(created).toMatchObject({
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2026',
          region: '',
          status: 'pending',
          activityCount: 0,
          pointCount: 0,
          cursorOffset: 0,
          isPartial: false,
          segments: []
        })

        const fetched = await database.getFitnessRouteHeatmap({
          id: created.id
        })
        expect(fetched?.id).toBe(created.id)
        expect(fetched?.segments).toEqual([])
      })

      it('uses stable keys for all-activity caches', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })

        const found = await database.getFitnessRouteHeatmapByKey({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })

        expect(found?.id).toBe(created.id)
        expect(found?.activityType).toBeUndefined()
      })
    })

    describe('updateFitnessRouteHeatmapStatus', () => {
      it('stores bounds, segments, counts, and errors as route payload', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'cycling',
          periodType: 'monthly',
          periodKey: '2026-04',
          region: 'netherlands'
        })

        const updated = await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'completed',
          bounds: {
            minLat: 52,
            maxLat: 53,
            minLng: 4,
            maxLng: 5
          },
          segments: [
            {
              points: [
                { lat: 52.1, lng: 4.3 },
                { lat: 52.2, lng: 4.4 }
              ]
            },
            {
              isHiddenByPrivacy: true,
              points: [
                { lat: 52.3, lng: 4.5 },
                { lat: 52.4, lng: 4.6 }
              ]
            }
          ],
          activityCount: 2,
          pointCount: 4,
          cursorOffset: 25,
          isPartial: true,
          error: null
        })

        expect(updated).toBe(true)

        const fetched = await database.getFitnessRouteHeatmap({
          id: created.id
        })
        expect(fetched?.status).toBe('completed')
        expect(fetched?.bounds).toEqual({
          minLat: 52,
          maxLat: 53,
          minLng: 4,
          maxLng: 5
        })
        expect(fetched?.segments).toHaveLength(2)
        expect(fetched?.activityCount).toBe(2)
        expect(fetched?.pointCount).toBe(4)
        expect(fetched?.cursorOffset).toBe(25)
        expect(fetched?.isPartial).toBe(true)
      })

      it('returns false for non-existent ids', async () => {
        const result = await database.updateFitnessRouteHeatmapStatus({
          id: 'missing-route-cache',
          status: 'completed'
        })

        expect(result).toBe(false)
      })

      it('does not revive a route cache deleted after the restore cutoff', async () => {
        const cutoff = Date.now() - 10_000
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'delete-race-sql',
          periodType: 'monthly',
          periodKey: '2099-03'
        })

        await database.deleteFitnessRouteHeatmapsForActor({
          actorId: actors.replyAuthor.id
        })

        const result = await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'generating',
          clearDeleted: true,
          clearDeletedBefore: cutoff
        })

        expect(result).toBe(false)
        await expect(
          database.getFitnessRouteHeatmap({ id: created.id })
        ).resolves.toBeNull()
      })

      it('does not revive a deleted route cache without an explicit restore cutoff', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'delete-default-cutoff-sql',
          periodType: 'monthly',
          periodKey: '2099-04'
        })

        await database.deleteFitnessRouteHeatmapsForActor({
          actorId: actors.replyAuthor.id
        })

        const result = await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'generating',
          clearDeleted: true
        })

        expect(result).toBe(false)
        await expect(
          database.getFitnessRouteHeatmap({ id: created.id })
        ).resolves.toBeNull()
      })
    })

    describe('getFitnessRouteHeatmapsForActor', () => {
      it('filters by actor, activity type, period type, and region', async () => {
        await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'walking',
          periodType: 'yearly',
          periodKey: '2026',
          region: 'singapore'
        })
        await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'walking',
          periodType: 'monthly',
          periodKey: '2026-01',
          region: 'netherlands'
        })

        const results = await database.getFitnessRouteHeatmapsForActor({
          actorId: actors.primary.id,
          activityType: 'walking',
          periodType: 'yearly',
          region: 'singapore'
        })

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
          activityType: 'walking',
          periodType: 'yearly',
          region: 'singapore'
        })
      })

      it('returns summaries without route payload columns', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2027',
          region: 'summary-test'
        })
        await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'completed',
          bounds: {
            minLat: 52,
            maxLat: 53,
            minLng: 4,
            maxLng: 5
          },
          segments: [
            {
              points: [
                { lat: 52.1, lng: 4.2 },
                { lat: 52.2, lng: 4.3 }
              ]
            }
          ],
          activityCount: 1,
          pointCount: 2,
          isPartial: true
        })

        const summaries =
          await database.getFitnessRouteHeatmapSummariesForActor({
            actorId: actors.replyAuthor.id,
            region: 'summary-test'
          })

        expect(summaries).toHaveLength(1)
        expect(summaries[0]).toMatchObject({
          id: created.id,
          activityType: 'running',
          pointCount: 2,
          isPartial: true
        })
        expect('bounds' in summaries[0]).toBe(false)
        expect('segments' in summaries[0]).toBe(false)
      })

      it('returns distinct non-empty route heatmap regions for an actor', async () => {
        await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: null,
          periodType: 'monthly',
          periodKey: '2027-01',
          region: 'netherlands'
        })
        await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: null,
          periodType: 'monthly',
          periodKey: '2027-02',
          region: 'netherlands'
        })
        await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: null,
          periodType: 'monthly',
          periodKey: '2027-03',
          region: 'singapore'
        })

        await expect(
          database.getDistinctRouteHeatmapRegionsForActor({
            actorId: actors.replyAuthor.id
          })
        ).resolves.toEqual(expect.arrayContaining(['netherlands', 'singapore']))

        await database.deleteFitnessRouteHeatmapsForActor({
          actorId: actors.replyAuthor.id
        })

        await expect(
          database.getDistinctRouteHeatmapRegionsForActor({
            actorId: actors.replyAuthor.id
          })
        ).resolves.toEqual([])
        await expect(
          database.getDistinctRouteHeatmapRegionsForActor({
            actorId: actors.replyAuthor.id,
            includeDeleted: true
          })
        ).resolves.toEqual(expect.arrayContaining(['netherlands', 'singapore']))
      })
    })

    describe('getDistinctActivityTypesForActor', () => {
      it('returns distinct completed primary activity types from fitness files', async () => {
        const running = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/route-heatmap-test-run.fit',
          fileName: 'run.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        const cycling = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/route-heatmap-test-cycle.fit',
          fileName: 'cycle.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        expect(running).toBeDefined()
        expect(cycling).toBeDefined()

        await database.updateFitnessFileActivityData(running!.id, {
          activityType: 'running',
          activityStartTime: new Date('2026-01-15T08:00:00Z')
        })
        await database.updateFitnessFileProcessingStatus(
          running!.id,
          'completed'
        )
        await database.updateFitnessFileActivityData(cycling!.id, {
          activityType: 'cycling',
          activityStartTime: new Date('2026-01-16T08:00:00Z')
        })
        await database.updateFitnessFileProcessingStatus(
          cycling!.id,
          'completed'
        )

        const types = await database.getDistinctActivityTypesForActor({
          actorId: actors.primary.id
        })

        expect(types).toContain('running')
        expect(types).toContain('cycling')
        expect(types).toEqual([...types].sort())
      })
    })

    describe('deleteFitnessRouteHeatmapsForActor', () => {
      it('soft-deletes route heatmaps for an actor', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'hiking',
          periodType: 'monthly',
          periodKey: '2026-03'
        })

        const deletedCount = await database.deleteFitnessRouteHeatmapsForActor({
          actorId: actors.replyAuthor.id
        })

        expect(deletedCount).toBeGreaterThan(0)
        await expect(
          database.getFitnessRouteHeatmap({ id: created.id })
        ).resolves.toBeNull()
      })
    })

    // Kept last: softDeleteLegacyRegionRouteHeatmaps operates table-wide, so this
    // block clears every remaining legacy-region row and must run after the
    // others to avoid disturbing their fixtures.
    describe('legacy region cleanup', () => {
      it('counts and soft-deletes only legacy named-region rows', async () => {
        const before = await database.countLegacyRegionRouteHeatmaps()

        await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2099',
          region: 'cleanup-legacy-a'
        })
        await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2099',
          region: 'cleanup-legacy-b'
        })
        const worldRow = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2099',
          region: ''
        })
        const rectRow = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'yearly',
          periodKey: '2099',
          region: 'rect:52.00,5.00,51.00,6.00'
        })

        // Only the two named-region rows count; world ('') and rect: are excluded.
        expect(await database.countLegacyRegionRouteHeatmaps()).toBe(before + 2)

        const deleted = await database.softDeleteLegacyRegionRouteHeatmaps()
        expect(deleted).toBe(before + 2)
        expect(await database.countLegacyRegionRouteHeatmaps()).toBe(0)

        // The world and rect caches are left intact.
        await expect(
          database.getFitnessRouteHeatmap({ id: worldRow.id })
        ).resolves.not.toBeNull()
        await expect(
          database.getFitnessRouteHeatmap({ id: rectRow.id })
        ).resolves.not.toBeNull()
      })
    })
  })
})

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('FitnessHeatmapDatabase', () => {
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

    describe('createFitnessHeatmap / getFitnessHeatmap', () => {
      it('creates and retrieves a heatmap record', async () => {
        const created = await database.createFitnessHeatmap({
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2025',
          periodStart: new Date('2025-01-01T00:00:00Z'),
          periodEnd: new Date('2026-01-01T00:00:00Z')
        })

        expect(created).toBeDefined()
        expect(created.actorId).toBe(actors.primary.id)
        expect(created.activityType).toBe('running')
        expect(created.periodType).toBe('yearly')
        expect(created.periodKey).toBe('2025')
        expect(created.status).toBe('pending')
        expect(created.activityCount).toBe(0)

        const fetched = await database.getFitnessHeatmap({ id: created.id })
        expect(fetched).toBeDefined()
        expect(fetched?.id).toBe(created.id)
        expect(fetched?.activityType).toBe('running')
        expect(fetched?.periodType).toBe('yearly')
      })

      it('creates a heatmap with null activityType for all activities', async () => {
        const created = await database.createFitnessHeatmap({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })

        expect(created.activityType).toBeUndefined()
        expect(created.periodType).toBe('all_time')
        expect(created.periodStart).toBeUndefined()
        expect(created.periodEnd).toBeUndefined()
      })
    })

    describe('getFitnessHeatmapByKey', () => {
      it('retrieves by unique key with activityType', async () => {
        await database.createFitnessHeatmap({
          actorId: actors.primary.id,
          activityType: 'cycling',
          periodType: 'monthly',
          periodKey: '2025-06',
          periodStart: new Date('2025-06-01T00:00:00Z'),
          periodEnd: new Date('2025-07-01T00:00:00Z')
        })

        const found = await database.getFitnessHeatmapByKey({
          actorId: actors.primary.id,
          activityType: 'cycling',
          periodType: 'monthly',
          periodKey: '2025-06'
        })

        expect(found).toBeDefined()
        expect(found?.activityType).toBe('cycling')
        expect(found?.periodKey).toBe('2025-06')
      })

      it('retrieves by unique key with null activityType', async () => {
        const found = await database.getFitnessHeatmapByKey({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })

        expect(found).toBeDefined()
        expect(found?.activityType).toBeUndefined()
        expect(found?.periodType).toBe('all_time')
      })

      it('returns null for non-existent key', async () => {
        const found = await database.getFitnessHeatmapByKey({
          actorId: actors.primary.id,
          activityType: 'swimming',
          periodType: 'yearly',
          periodKey: '2099'
        })

        expect(found).toBeNull()
      })
    })

    describe('getFitnessHeatmapsForActor', () => {
      it('returns all heatmaps for an actor', async () => {
        const results = await database.getFitnessHeatmapsForActor({
          actorId: actors.primary.id
        })

        expect(results.length).toBeGreaterThanOrEqual(3)
      })

      it('filters by activityType', async () => {
        const results = await database.getFitnessHeatmapsForActor({
          actorId: actors.primary.id,
          activityType: 'cycling'
        })

        expect(results.length).toBeGreaterThanOrEqual(1)
        expect(results.every((r) => r.activityType === 'cycling')).toBe(true)
      })

      it('filters by null activityType', async () => {
        const results = await database.getFitnessHeatmapsForActor({
          actorId: actors.primary.id,
          activityType: null
        })

        expect(results.length).toBeGreaterThanOrEqual(1)
        expect(results.every((r) => r.activityType === undefined)).toBe(true)
      })

      it('filters by periodType', async () => {
        const results = await database.getFitnessHeatmapsForActor({
          actorId: actors.primary.id,
          periodType: 'monthly'
        })

        expect(results.length).toBeGreaterThanOrEqual(1)
        expect(results.every((r) => r.periodType === 'monthly')).toBe(true)
      })
    })

    describe('updateFitnessHeatmapStatus', () => {
      it('updates status and imagePath', async () => {
        const created = await database.createFitnessHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'running',
          periodType: 'all_time',
          periodKey: 'all'
        })

        const updated = await database.updateFitnessHeatmapStatus({
          id: created.id,
          status: 'completed',
          imagePath: 'heatmaps/test/running/all_time_all.png',
          activityCount: 42
        })

        expect(updated).toBe(true)

        const fetched = await database.getFitnessHeatmap({ id: created.id })
        expect(fetched?.status).toBe('completed')
        expect(fetched?.imagePath).toBe(
          'heatmaps/test/running/all_time_all.png'
        )
        expect(fetched?.activityCount).toBe(42)
      })

      it('updates status with error on failure', async () => {
        const created = await database.createFitnessHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'cycling',
          periodType: 'yearly',
          periodKey: '2025'
        })

        await database.updateFitnessHeatmapStatus({
          id: created.id,
          status: 'failed',
          error: 'Out of memory'
        })

        const fetched = await database.getFitnessHeatmap({ id: created.id })
        expect(fetched?.status).toBe('failed')
        expect(fetched?.error).toBe('Out of memory')
      })

      it('returns false for non-existent id', async () => {
        const result = await database.updateFitnessHeatmapStatus({
          id: 'non-existent-id',
          status: 'completed'
        })

        expect(result).toBe(false)
      })
    })

    describe('getDistinctActivityTypesForActor', () => {
      it('returns distinct activity types from fitness files', async () => {
        // Create fitness files with different activity types
        await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/heatmap-test-run.fit',
          fileName: 'run.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        const runFile = (
          await database.getFitnessFilesByActor({
            actorId: actors.primary.id,
            limit: 1
          })
        )[0]

        await database.updateFitnessFileActivityData(runFile.id, {
          activityType: 'running',
          activityStartTime: new Date('2025-01-15T08:00:00Z')
        })
        await database.updateFitnessFileProcessingStatus(
          runFile.id,
          'completed'
        )

        await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/heatmap-test-cycle.fit',
          fileName: 'cycle.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        const actorFiles = await database.getFitnessFilesByActor({
          actorId: actors.primary.id,
          limit: 100
        })
        const cycleFile = actorFiles.find(
          (f) => f.fileName === 'cycle.fit' && !f.activityType
        )

        if (cycleFile) {
          await database.updateFitnessFileActivityData(cycleFile.id, {
            activityType: 'cycling',
            activityStartTime: new Date('2025-01-16T08:00:00Z')
          })
          await database.updateFitnessFileProcessingStatus(
            cycleFile.id,
            'completed'
          )
        }

        const types = await database.getDistinctActivityTypesForActor({
          actorId: actors.primary.id
        })

        expect(types).toContain('running')
        expect(types).toContain('cycling')
        expect(types).toEqual([...types].sort())
      })
    })

    describe('deleteFitnessHeatmapsForActor', () => {
      it('soft-deletes all heatmaps for an actor', async () => {
        const created = await database.createFitnessHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'hiking',
          periodType: 'monthly',
          periodKey: '2025-03'
        })

        const deletedCount = await database.deleteFitnessHeatmapsForActor({
          actorId: actors.replyAuthor.id
        })

        expect(deletedCount).toBeGreaterThan(0)

        const fetched = await database.getFitnessHeatmap({ id: created.id })
        expect(fetched).toBeNull()
      })
    })
  })
})

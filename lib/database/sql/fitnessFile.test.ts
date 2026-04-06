import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('FitnessFileDatabase', () => {
  const { actors, statuses } = DatabaseSeed
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

    describe('createFitnessFile/getFitnessFile/getFitnessFilesByActor', () => {
      it('creates and retrieves a fitness file record', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/create-retrieve.fit',
          fileName: 'create-retrieve.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 2048,
          description: 'Morning run'
        })

        expect(created).toBeDefined()
        expect(created?.actorId).toBe(actors.primary.id)
        expect(created?.bytes).toBe(2048)

        const fetched = await database.getFitnessFile({ id: created!.id })
        expect(fetched).toMatchObject({
          id: created!.id,
          actorId: actors.primary.id,
          path: 'fitness/create-retrieve.fit',
          fileName: 'create-retrieve.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 2048,
          description: 'Morning run',
          processingStatus: 'pending',
          hasMapData: false
        })

        const actorFiles = await database.getFitnessFilesByActor({
          actorId: actors.primary.id,
          limit: 100
        })
        expect(actorFiles.some((item) => item.id === created!.id)).toBe(true)
      })
    })

    describe('getFitnessFileByStatus/updateFitnessFileStatus', () => {
      it('reads by status and updates status association', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.replyAuthor.id,
          statusId: statuses.replyAuthor.replyToPrimary,
          path: 'fitness/by-status.gpx',
          fileName: 'by-status.gpx',
          fileType: 'gpx',
          mimeType: 'application/gpx+xml',
          bytes: 4096
        })

        expect(created).toBeDefined()

        const linkedFile = await database.getFitnessFileByStatus({
          statusId: statuses.replyAuthor.replyToPrimary
        })
        expect(linkedFile?.id).toBe(created?.id)

        const updated = await database.updateFitnessFileStatus(
          created!.id,
          statuses.replyAuthor.mentionReplyToPrimary
        )
        expect(updated).toBe(true)

        const oldStatusFile = await database.getFitnessFileByStatus({
          statusId: statuses.replyAuthor.replyToPrimary
        })
        expect(oldStatusFile).toBeNull()

        const newStatusFile = await database.getFitnessFileByStatus({
          statusId: statuses.replyAuthor.mentionReplyToPrimary
        })
        expect(newStatusFile?.id).toBe(created?.id)
      })

      it('returns primary file and full ordered status files', async () => {
        const first = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/status-multi-1.fit',
          fileName: 'status-multi-1.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        const second = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/status-multi-2.fit',
          fileName: 'status-multi-2.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        expect(first).toBeDefined()
        expect(second).toBeDefined()

        await database.updateFitnessFileStatus(first!.id, statuses.primary.post)
        await database.updateFitnessFileStatus(
          second!.id,
          statuses.primary.post
        )
        await database.updateFitnessFilePrimary(first!.id, false)
        await database.updateFitnessFilePrimary(second!.id, true)
        await database.updateFitnessFileActivityData(second!.id, {
          activityStartTime: new Date('2026-01-01T00:00:00.000Z')
        })
        await database.updateFitnessFileActivityData(first!.id, {
          activityStartTime: new Date('2026-01-02T00:00:00.000Z')
        })

        const primary = await database.getFitnessFileByStatus({
          statusId: statuses.primary.post
        })
        expect(primary?.id).toBe(second!.id)

        const files = await database.getFitnessFilesByStatus({
          statusId: statuses.primary.post
        })
        const ids = files
          .filter((file) => file.id === first!.id || file.id === second!.id)
          .map((item) => item.id)

        expect(ids).toEqual([second!.id, first!.id])
      })
    })

    describe('updateFitnessFileProcessingStatus/updateFitnessFileActivityData', () => {
      it('updates processing status and parsed activity data', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/processing.fit',
          fileName: 'processing.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        expect(created).toBeDefined()
        expect(created?.processingStatus).toBe('pending')

        const processingUpdated =
          await database.updateFitnessFileProcessingStatus(
            created!.id,
            'processing'
          )
        expect(processingUpdated).toBe(true)

        const metadataUpdated = await database.updateFitnessFileActivityData(
          created!.id,
          {
            totalDistanceMeters: 5_000,
            totalDurationSeconds: 1_500,
            elevationGainMeters: 120,
            activityType: 'running',
            activityStartTime: new Date('2026-01-01T00:00:00.000Z'),
            hasMapData: true,
            mapImagePath: 'medias/route-map.png'
          }
        )
        expect(metadataUpdated).toBe(true)

        const fetched = await database.getFitnessFile({ id: created!.id })
        expect(fetched).toMatchObject({
          processingStatus: 'processing',
          totalDistanceMeters: 5_000,
          totalDurationSeconds: 1_500,
          elevationGainMeters: 120,
          activityType: 'running',
          hasMapData: true,
          mapImagePath: 'medias/route-map.png'
        })
        expect(fetched?.activityStartTime).toBeDefined()
      })
    })

    describe('import fields', () => {
      it('creates import metadata, updates import status, and lists by batch', async () => {
        const importedOne = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/import-a.fit',
          fileName: 'import-a.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1_000,
          importBatchId: 'batch-1'
        })
        const importedTwo = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/import-b.gpx',
          fileName: 'import-b.gpx',
          fileType: 'gpx',
          mimeType: 'application/gpx+xml',
          bytes: 2_000,
          importBatchId: 'batch-1'
        })
        const normalUpload = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/import-c.tcx',
          fileName: 'import-c.tcx',
          fileType: 'tcx',
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 3_000
        })

        expect(importedOne?.importStatus).toBe('pending')
        expect(importedOne?.isPrimary).toBe(true)
        expect(normalUpload?.importStatus).toBeUndefined()

        const failedUpdated = await database.updateFitnessFileImportStatus(
          importedTwo!.id,
          'failed',
          'parse failed'
        )
        expect(failedUpdated).toBe(true)

        const primaryUpdated = await database.updateFitnessFilePrimary(
          importedTwo!.id,
          false
        )
        expect(primaryUpdated).toBe(true)

        const batchFiles = await database.getFitnessFilesByBatchId({
          batchId: 'batch-1'
        })
        expect(batchFiles).toHaveLength(2)
        expect(batchFiles.map((item) => item.id)).toEqual([
          importedOne!.id,
          importedTwo!.id
        ])

        const failedFile = await database.getFitnessFile({
          id: importedTwo!.id
        })
        expect(failedFile?.importStatus).toBe('failed')
        expect(failedFile?.importError).toBe('parse failed')
        expect(failedFile?.isPrimary).toBe(false)
      })

      it('gets files by ids in request order', async () => {
        const first = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/by-ids-a.fit',
          fileName: 'by-ids-a.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1_000,
          importBatchId: 'batch-order'
        })
        const second = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/by-ids-b.fit',
          fileName: 'by-ids-b.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1_000,
          importBatchId: 'batch-order'
        })
        const third = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/by-ids-c.fit',
          fileName: 'by-ids-c.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1_000,
          importBatchId: 'batch-order'
        })

        const files = await database.getFitnessFilesByIds({
          fitnessFileIds: [third!.id, 'missing-id', first!.id, second!.id]
        })

        expect(files.map((item) => item.id)).toEqual([
          third!.id,
          first!.id,
          second!.id
        ])
      })

      it('updates batch import state and grouped status assignment', async () => {
        const primary = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/group-primary.fit',
          fileName: 'group-primary.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1_000,
          importBatchId: 'batch-group'
        })
        const secondary = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/group-secondary.fit',
          fileName: 'group-secondary.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1_000,
          importBatchId: 'batch-group'
        })

        const importUpdated = await database.updateFitnessFilesImportStatus({
          fitnessFileIds: [primary!.id, secondary!.id],
          importStatus: 'failed',
          importError: 'temporary failure'
        })
        expect(importUpdated).toBe(2)

        const processingUpdated =
          await database.updateFitnessFilesProcessingStatus({
            fitnessFileIds: [primary!.id, secondary!.id],
            processingStatus: 'processing'
          })
        expect(processingUpdated).toBe(2)

        const assigned = await database.assignFitnessFilesToImportedStatus({
          fitnessFileIds: [primary!.id, secondary!.id],
          primaryFitnessFileId: secondary!.id,
          statusId: statuses.primary.post
        })
        expect(assigned).toBe(2)

        const updatedPrimary = await database.getFitnessFile({
          id: primary!.id
        })
        const updatedSecondary = await database.getFitnessFile({
          id: secondary!.id
        })

        expect(updatedPrimary?.statusId).toBe(statuses.primary.post)
        expect(updatedPrimary?.isPrimary).toBe(false)
        expect(updatedPrimary?.importStatus).toBe('completed')
        expect(updatedPrimary?.importError).toBeUndefined()
        expect(updatedPrimary?.processingStatus).toBe('completed')

        expect(updatedSecondary?.statusId).toBe(statuses.primary.post)
        expect(updatedSecondary?.isPrimary).toBe(true)
        expect(updatedSecondary?.importStatus).toBe('completed')
        expect(updatedSecondary?.importError).toBeUndefined()
        expect(updatedSecondary?.processingStatus).toBe('pending')
      })
    })

    describe('getFitnessFilesWithStatusForAccount', () => {
      it('returns paginated fitness files scoped to account', async () => {
        const actor = await database.getActorFromId({ id: actors.primary.id })
        expect(actor?.account?.id).toBeDefined()

        const accountId = actor!.account!.id
        const before = await database.getFitnessFilesWithStatusForAccount({
          accountId,
          limit: 100,
          page: 1
        })

        const first = await database.createFitnessFile({
          actorId: actors.primary.id,
          statusId: statuses.primary.post,
          path: 'fitness/account-list-1.fit',
          fileName: 'account-list-1.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        const second = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/account-list-2.gpx',
          fileName: 'account-list-2.gpx',
          fileType: 'gpx',
          mimeType: 'application/gpx+xml',
          bytes: 2048
        })
        const otherAccount = await database.createFitnessFile({
          actorId: actors.replyAuthor.id,
          path: 'fitness/other-account.tcx',
          fileName: 'other-account.tcx',
          fileType: 'tcx',
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 4096
        })

        expect(first).toBeDefined()
        expect(second).toBeDefined()
        expect(otherAccount).toBeDefined()

        const pageOne = await database.getFitnessFilesWithStatusForAccount({
          accountId,
          limit: 1,
          page: 1
        })
        const pageTwo = await database.getFitnessFilesWithStatusForAccount({
          accountId,
          limit: 1,
          page: 2
        })
        const allForAccount =
          await database.getFitnessFilesWithStatusForAccount({
            accountId,
            limit: 100,
            page: 1
          })

        expect(pageOne.total).toBe(before.total + 2)
        expect(pageOne.items).toHaveLength(1)
        expect(pageTwo.items).toHaveLength(1)
        expect([pageOne.items[0]?.id, pageTwo.items[0]?.id].sort()).toEqual(
          [first!.id, second!.id].sort()
        )

        const linked = allForAccount.items.find((item) => item.id === first!.id)
        expect(linked?.statusId).toBe(statuses.primary.post)
        expect(
          allForAccount.items.some((item) => item.id === otherAccount!.id)
        ).toBe(false)
      })
    })

    describe('getFitnessActivitySummary', () => {
      it('returns activity counts and totals grouped by type within date range', async () => {
        const run1 = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/summary-run1.fit',
          fileName: 'summary-run1.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        const run2 = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/summary-run2.fit',
          fileName: 'summary-run2.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        const cycle1 = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/summary-cycle1.fit',
          fileName: 'summary-cycle1.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        await database.updateFitnessFileActivityData(run1!.id, {
          activityType: 'running',
          activityStartTime: new Date('2026-02-10T08:00:00.000Z'),
          totalDistanceMeters: 5000,
          totalDurationSeconds: 1500,
          elevationGainMeters: 100
        })
        await database.updateFitnessFileProcessingStatus(run1!.id, 'completed')

        await database.updateFitnessFileActivityData(run2!.id, {
          activityType: 'running',
          activityStartTime: new Date('2026-02-15T09:00:00.000Z'),
          totalDistanceMeters: 8000,
          totalDurationSeconds: 2400,
          elevationGainMeters: 150
        })
        await database.updateFitnessFileProcessingStatus(run2!.id, 'completed')

        await database.updateFitnessFileActivityData(cycle1!.id, {
          activityType: 'cycling',
          activityStartTime: new Date('2026-02-12T10:00:00.000Z'),
          totalDistanceMeters: 20000,
          totalDurationSeconds: 3600,
          elevationGainMeters: 300
        })
        await database.updateFitnessFileProcessingStatus(
          cycle1!.id,
          'completed'
        )

        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: new Date('2026-02-01T00:00:00.000Z').getTime(),
          endDate: new Date('2026-03-01T00:00:00.000Z').getTime()
        })

        expect(summary).toHaveLength(2)

        const running = summary.find((s) => s.activityType === 'running')
        expect(running).toMatchObject({
          activityType: 'running',
          count: 2,
          totalDistanceMeters: 13000,
          totalDurationSeconds: 3900,
          totalElevationGainMeters: 250
        })

        const cycling = summary.find((s) => s.activityType === 'cycling')
        expect(cycling).toMatchObject({
          activityType: 'cycling',
          count: 1,
          totalDistanceMeters: 20000,
          totalDurationSeconds: 3600,
          totalElevationGainMeters: 300
        })
      })

      it('excludes fitness files outside the date range', async () => {
        const outside = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/summary-outside.fit',
          fileName: 'summary-outside.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        await database.updateFitnessFileActivityData(outside!.id, {
          activityType: 'running',
          activityStartTime: new Date('2026-06-01T08:00:00.000Z'),
          totalDistanceMeters: 3000,
          totalDurationSeconds: 900,
          elevationGainMeters: 50
        })
        await database.updateFitnessFileProcessingStatus(
          outside!.id,
          'completed'
        )

        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: new Date('2026-05-01T00:00:00.000Z').getTime(),
          endDate: new Date('2026-05-31T00:00:00.000Z').getTime()
        })

        expect(summary).toHaveLength(0)
      })

      it('returns empty array when no fitness files exist in range', async () => {
        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: new Date('2020-01-01T00:00:00.000Z').getTime(),
          endDate: new Date('2020-02-01T00:00:00.000Z').getTime()
        })

        expect(summary).toEqual([])
      })
    })

    describe('getActorHasFitnessData', () => {
      it('returns true when actor has completed fitness files', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/has-data-completed.fit',
          fileName: 'has-data-completed.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        expect(created).toBeDefined()

        await database.updateFitnessFileProcessingStatus(
          created!.id,
          'completed'
        )

        const result = await database.getActorHasFitnessData({
          actorId: actors.extra.id
        })
        expect(result).toBe(true)
      })

      it('returns false when actor has no fitness files', async () => {
        const result = await database.getActorHasFitnessData({
          actorId: 'non-existent-actor-id'
        })
        expect(result).toBe(false)
      })

      it('returns false when actor only has pending/failed fitness files', async () => {
        const pending = await database.createFitnessFile({
          actorId: actors.replyAuthor.id,
          path: 'fitness/has-data-pending.fit',
          fileName: 'has-data-pending.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        const failed = await database.createFitnessFile({
          actorId: actors.replyAuthor.id,
          path: 'fitness/has-data-failed.fit',
          fileName: 'has-data-failed.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        expect(pending).toBeDefined()
        expect(failed).toBeDefined()

        await database.updateFitnessFileProcessingStatus(failed!.id, 'failed')

        const result = await database.getActorHasFitnessData({
          actorId: actors.replyAuthor.id
        })
        expect(result).toBe(false)
      })
    })

    describe('getFitnessActivityCalendarData', () => {
      it('returns per-day aggregates grouped by date', async () => {
        const day1a = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/cal-day1a.fit',
          fileName: 'cal-day1a.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 512
        })
        const day1b = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/cal-day1b.fit',
          fileName: 'cal-day1b.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 512
        })
        const day2 = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/cal-day2.fit',
          fileName: 'cal-day2.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 512
        })

        await database.updateFitnessFileActivityData(day1a!.id, {
          activityType: 'running',
          activityStartTime: new Date('2027-03-10T08:00:00.000Z'),
          totalDistanceMeters: 5000,
          totalDurationSeconds: 1800
        })
        await database.updateFitnessFileProcessingStatus(day1a!.id, 'completed')

        await database.updateFitnessFileActivityData(day1b!.id, {
          activityType: 'cycling',
          activityStartTime: new Date('2027-03-10T17:00:00.000Z'),
          totalDistanceMeters: 15000,
          totalDurationSeconds: 3600
        })
        await database.updateFitnessFileProcessingStatus(day1b!.id, 'completed')

        await database.updateFitnessFileActivityData(day2!.id, {
          activityType: 'running',
          activityStartTime: new Date('2027-03-12T09:00:00.000Z'),
          totalDistanceMeters: 8000,
          totalDurationSeconds: 2400
        })
        await database.updateFitnessFileProcessingStatus(day2!.id, 'completed')

        const result = await database.getFitnessActivityCalendarData({
          actorId: actors.extra.id,
          startDate: new Date('2027-03-01T00:00:00.000Z').getTime(),
          endDate: new Date('2027-04-01T00:00:00.000Z').getTime()
        })

        expect(result).toHaveLength(2)
        expect(result[0]).toMatchObject({
          date: '2027-03-10',
          count: 2,
          totalDistanceMeters: 20000,
          totalDurationSeconds: 5400
        })
        expect(result[1]).toMatchObject({
          date: '2027-03-12',
          count: 1,
          totalDistanceMeters: 8000,
          totalDurationSeconds: 2400
        })
      })

      it('returns empty array when no data in range', async () => {
        const result = await database.getFitnessActivityCalendarData({
          actorId: actors.extra.id,
          startDate: new Date('2010-01-01T00:00:00.000Z').getTime(),
          endDate: new Date('2010-02-01T00:00:00.000Z').getTime()
        })

        expect(result).toEqual([])
      })

      it('filters by activityType when provided', async () => {
        const result = await database.getFitnessActivityCalendarData({
          actorId: actors.extra.id,
          startDate: new Date('2027-03-01T00:00:00.000Z').getTime(),
          endDate: new Date('2027-04-01T00:00:00.000Z').getTime(),
          activityType: 'running'
        })

        expect(result).toHaveLength(2)
        expect(result[0]).toMatchObject({
          date: '2027-03-10',
          count: 1,
          totalDistanceMeters: 5000,
          totalDurationSeconds: 1800
        })
        expect(result[1]).toMatchObject({
          date: '2027-03-12',
          count: 1,
          totalDistanceMeters: 8000,
          totalDurationSeconds: 2400
        })
      })

      it('excludes deleted and non-primary files', async () => {
        const deleted = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/cal-deleted.fit',
          fileName: 'cal-deleted.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 512
        })
        await database.updateFitnessFileActivityData(deleted!.id, {
          activityType: 'running',
          activityStartTime: new Date('2027-04-05T08:00:00.000Z'),
          totalDistanceMeters: 3000,
          totalDurationSeconds: 900
        })
        await database.updateFitnessFileProcessingStatus(
          deleted!.id,
          'completed'
        )
        await database.deleteFitnessFile({ id: deleted!.id })

        const nonPrimary = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/cal-nonprimary.fit',
          fileName: 'cal-nonprimary.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 512
        })
        await database.updateFitnessFileActivityData(nonPrimary!.id, {
          activityType: 'running',
          activityStartTime: new Date('2027-04-06T08:00:00.000Z'),
          totalDistanceMeters: 4000,
          totalDurationSeconds: 1200
        })
        await database.updateFitnessFileProcessingStatus(
          nonPrimary!.id,
          'completed'
        )
        await database.updateFitnessFilePrimary(nonPrimary!.id, false)

        const result = await database.getFitnessActivityCalendarData({
          actorId: actors.extra.id,
          startDate: new Date('2027-04-01T00:00:00.000Z').getTime(),
          endDate: new Date('2027-05-01T00:00:00.000Z').getTime()
        })

        expect(result).toEqual([])
      })
    })

    describe('deleteFitnessFile', () => {
      it('soft deletes a file and updates usage counters', async () => {
        const actor = await database.getActorFromId({ id: actors.extra.id })
        expect(actor?.account?.id).toBeDefined()

        const accountId = actor!.account!.id
        const beforeUsage = await database.getFitnessStorageUsageForAccount({
          accountId
        })

        const created = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/delete-me.tcx',
          fileName: 'delete-me.tcx',
          fileType: 'tcx',
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 8192
        })
        expect(created).toBeDefined()

        const afterCreateUsage =
          await database.getFitnessStorageUsageForAccount({ accountId })
        expect(afterCreateUsage).toBe(beforeUsage + 8192)

        const deleted = await database.deleteFitnessFile({ id: created!.id })
        expect(deleted).toBe(true)

        const afterDeleteUsage =
          await database.getFitnessStorageUsageForAccount({ accountId })
        expect(afterDeleteUsage).toBe(beforeUsage)

        const deletedFile = await database.getFitnessFile({ id: created!.id })
        expect(deletedFile).toBeNull()

        const actorFiles = await database.getFitnessFilesByActor({
          actorId: actors.extra.id,
          limit: 100
        })
        expect(actorFiles.find((item) => item.id === created!.id)).toBeFalsy()
      })

      it('returns false when deleting a missing file', async () => {
        const deleted = await database.deleteFitnessFile({
          id: 'not-found-fitness-file-id'
        })
        expect(deleted).toBe(false)
      })
    })
  })
})

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
        await database.updateFitnessFileStatus(second!.id, statuses.primary.post)
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

        const failedFile = await database.getFitnessFile({ id: importedTwo!.id })
        expect(failedFile?.importStatus).toBe('failed')
        expect(failedFile?.importError).toBe('parse failed')
        expect(failedFile?.isPrimary).toBe(false)
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

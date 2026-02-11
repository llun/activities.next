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
          description: 'Morning run'
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

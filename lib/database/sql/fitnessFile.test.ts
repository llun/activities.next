import { MAX_FITNESS_IMPORT_ERROR_LENGTH } from '@/lib/database/sql/fitnessFile'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  DateKey,
  instantAtLocalWallTime,
  localDayWindow,
  parseDateKey,
  startOfLocalDay
} from '@/lib/fitness/calendar/localDay'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { FitnessProcessingStatus } from '@/lib/types/database/fitnessFile'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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

      it('persists and backfills the import sourceUrl', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/source-url.tcx',
          fileName: 'source-url.tcx',
          fileType: 'tcx',
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 1024,
          sourceUrl: 'https://www.strava.com/activities/123'
        })

        expect(created?.sourceUrl).toBe('https://www.strava.com/activities/123')

        const fetched = await database.getFitnessFile({ id: created!.id })
        expect(fetched?.sourceUrl).toBe('https://www.strava.com/activities/123')

        await database.updateFitnessFileActivityData(created!.id, {
          sourceUrl: 'https://www.strava.com/activities/456'
        })
        const updated = await database.getFitnessFile({ id: created!.id })
        expect(updated?.sourceUrl).toBe('https://www.strava.com/activities/456')
      })

      it('uses a deterministic id tiebreaker when files share createdAt', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))

        try {
          const first = await database.createFitnessFile({
            actorId: actors.extra.id,
            path: 'fitness/same-created-at-1.fit',
            fileName: 'same-created-at-1.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 1024
          })
          const second = await database.createFitnessFile({
            actorId: actors.extra.id,
            path: 'fitness/same-created-at-2.fit',
            fileName: 'same-created-at-2.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 1024
          })
          const third = await database.createFitnessFile({
            actorId: actors.extra.id,
            path: 'fitness/same-created-at-3.fit',
            fileName: 'same-created-at-3.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 1024
          })

          expect(first).toBeDefined()
          expect(second).toBeDefined()
          expect(third).toBeDefined()

          const actorFiles = await database.getFitnessFilesByActor({
            actorId: actors.extra.id,
            limit: 3
          })

          expect(actorFiles.map((item) => item.id)).toEqual(
            [first!.id, second!.id, third!.id].sort().reverse()
          )
        } finally {
          vi.useRealTimers()
        }
      })
    })

    describe('countFitnessFilesByActor', () => {
      it('counts files matching the route-heatmap filters', async () => {
        // followRequester is otherwise unused in this suite, and the created
        // files are deleted afterwards, so the shared seed DB stays isolated.
        const actorId = actors.followRequester.id
        const activityType = 'count-test-activity'
        const dates = [
          new Date('2026-02-10T08:00:00Z'),
          new Date('2026-02-20T08:00:00Z'),
          new Date('2026-03-05T08:00:00Z')
        ]
        const createdIds: string[] = []

        try {
          for (const [index, activityStartTime] of dates.entries()) {
            const file = await database.createFitnessFile({
              actorId,
              path: `fitness/count-${index}.fit`,
              fileName: `count-${index}.fit`,
              fileType: 'fit',
              mimeType: 'application/vnd.ant.fit',
              bytes: 1024
            })
            createdIds.push(file!.id)
            await database.updateFitnessFileActivityData(file!.id, {
              activityType,
              activityStartTime
            })
            await database.updateFitnessFileProcessingStatus(
              file!.id,
              'completed'
            )
            await database.updateFitnessFilePrimary(file!.id, true)
          }

          // A non-completed, non-primary file the filters must exclude.
          const pending = await database.createFitnessFile({
            actorId,
            path: 'fitness/count-pending.fit',
            fileName: 'count-pending.fit',
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 1024
          })
          createdIds.push(pending!.id)
          await database.updateFitnessFileActivityData(pending!.id, {
            activityType,
            activityStartTime: new Date('2026-02-15T08:00:00Z')
          })

          await expect(
            database.countFitnessFilesByActor({
              actorId,
              processingStatus: 'completed',
              isPrimary: true,
              activityType
            })
          ).resolves.toBe(3)

          // Date window scopes the count to the matching period.
          await expect(
            database.countFitnessFilesByActor({
              actorId,
              processingStatus: 'completed',
              isPrimary: true,
              activityType,
              startDate: new Date('2026-02-01T00:00:00Z'),
              endDate: new Date('2026-02-28T23:59:59Z')
            })
          ).resolves.toBe(2)
        } finally {
          for (const id of createdIds) {
            await database.deleteFitnessFile({ id })
          }
        }
      })

      it('maintains parity with getFitnessFilesByActor across individual and combined filters', async () => {
        const actorId = actors.followRequester.id
        const createdIds: string[] = []

        const filesData = [
          {
            key: 'primary-run-completed',
            isPrimary: true,
            processingStatus: 'completed',
            activityType: 'Run',
            activityStartTime: new Date('2026-03-01T10:00:00Z')
          },
          {
            key: 'sibling-run-completed',
            isPrimary: false,
            processingStatus: 'completed',
            activityType: 'Run',
            activityStartTime: new Date('2026-03-01T10:00:00Z')
          },
          {
            key: 'primary-ride-failed',
            isPrimary: true,
            processingStatus: 'failed',
            activityType: 'Ride',
            activityStartTime: new Date('2026-03-05T10:00:00Z')
          },
          {
            key: 'primary-null-completed',
            isPrimary: true,
            processingStatus: 'completed',
            activityType: null,
            activityStartTime: new Date('2026-03-10T10:00:00Z')
          },
          {
            key: 'primary-walk-start-boundary',
            isPrimary: true,
            processingStatus: 'completed',
            activityType: 'Walk',
            activityStartTime: new Date('2026-03-15T00:00:00Z')
          },
          {
            key: 'primary-walk-end-boundary',
            isPrimary: true,
            processingStatus: 'completed',
            activityType: 'Walk',
            activityStartTime: new Date('2026-03-20T23:59:59Z')
          },
          {
            key: 'sibling-null-pending',
            isPrimary: false,
            processingStatus: 'pending',
            activityType: null,
            activityStartTime: new Date('2026-03-25T10:00:00Z')
          }
        ]

        try {
          for (const item of filesData) {
            const file = await database.createFitnessFile({
              actorId,
              path: `fitness/parity-${item.key}.fit`,
              fileName: `parity-${item.key}.fit`,
              fileType: 'fit',
              mimeType: 'application/vnd.ant.fit',
              bytes: 1024
            })
            createdIds.push(file!.id)

            await database.updateFitnessFileActivityData(file!.id, {
              activityType: item.activityType,
              activityStartTime: item.activityStartTime
            })
            await database.updateFitnessFileProcessingStatus(
              file!.id,
              item.processingStatus as FitnessProcessingStatus
            )
            await database.updateFitnessFilePrimary(file!.id, item.isPrimary)
          }

          const filterCases = [
            { name: 'all files for actor', filter: { actorId } },
            {
              name: 'primary files only',
              filter: { actorId, isPrimary: true }
            },
            {
              name: 'non-primary (sibling) files only',
              filter: { actorId, isPrimary: false }
            },
            {
              name: 'processingStatus: failed',
              filter: { actorId, processingStatus: 'failed' }
            },
            {
              name: 'processingStatus: completed',
              filter: { actorId, processingStatus: 'completed' }
            },
            {
              name: 'processingStatus: pending',
              filter: { actorId, processingStatus: 'pending' }
            },
            {
              name: 'null activity type',
              filter: { actorId, activityType: null }
            },
            {
              name: 'activityType: Run',
              filter: { actorId, activityType: 'Run' }
            },
            {
              name: 'activityType: Walk',
              filter: { actorId, activityType: 'Walk' }
            },
            {
              name: 'activityType: Ride',
              filter: { actorId, activityType: 'Ride' }
            },
            {
              name: 'non-existent activityType',
              filter: { actorId, activityType: 'Swim' }
            },
            {
              name: 'inclusive date range (March 15 to March 20)',
              filter: {
                actorId,
                startDate: new Date('2026-03-15T00:00:00Z'),
                endDate: new Date('2026-03-20T23:59:59Z')
              }
            },
            {
              name: 'exact date point (start boundary exact)',
              filter: {
                actorId,
                startDate: new Date('2026-03-15T00:00:00Z'),
                endDate: new Date('2026-03-15T00:00:00Z')
              }
            },
            {
              name: 'combined: completed primary Run',
              filter: {
                actorId,
                processingStatus: 'completed',
                isPrimary: true,
                activityType: 'Run'
              }
            },
            {
              name: 'combined: completed primary with null activityType',
              filter: {
                actorId,
                processingStatus: 'completed',
                isPrimary: true,
                activityType: null
              }
            },
            {
              name: 'combined: failed primary Ride',
              filter: {
                actorId,
                processingStatus: 'failed',
                isPrimary: true,
                activityType: 'Ride'
              }
            },
            {
              name: 'combined: pending non-primary null activityType',
              filter: {
                actorId,
                processingStatus: 'pending',
                isPrimary: false,
                activityType: null
              }
            },
            {
              name: 'combined: date window + completed + primary + Walk',
              filter: {
                actorId,
                startDate: new Date('2026-03-14T00:00:00Z'),
                endDate: new Date('2026-03-21T00:00:00Z'),
                processingStatus: 'completed',
                isPrimary: true,
                activityType: 'Walk'
              }
            }
          ]

          for (const { name: _name, filter } of filterCases) {
            const list = await database.getFitnessFilesByActor({
              ...filter,
              limit: 1000,
              offset: 0
            })
            const count = await database.countFitnessFilesByActor(filter)

            expect(count).toBe(list.length)
          }
        } finally {
          for (const id of createdIds) {
            await database.deleteFitnessFile({ id })
          }
        }
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

        const testStatusId = statuses.primary.secondPost
        await database.updateFitnessFileStatus(first!.id, testStatusId)
        await database.updateFitnessFileStatus(second!.id, testStatusId)
        await database.updateFitnessFilePrimary(first!.id, false)
        await database.updateFitnessFilePrimary(second!.id, true)
        await database.updateFitnessFileActivityData(second!.id, {
          activityStartTime: new Date('2026-01-01T00:00:00.000Z')
        })
        await database.updateFitnessFileActivityData(first!.id, {
          activityStartTime: new Date('2026-01-02T00:00:00.000Z')
        })

        const primary = await database.getFitnessFileByStatus({
          statusId: testStatusId
        })
        expect(primary?.id).toBe(second!.id)

        const files = await database.getFitnessFilesByStatus({
          statusId: testStatusId
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

      it('persists and retrieves fitness summary metrics and elevation series', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/summary-metrics.fit',
          fileName: 'summary-metrics.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 4096
        })

        const metadataUpdated = await database.updateFitnessFileActivityData(
          created!.id,
          {
            avgPower: 215,
            maxPower: 620,
            avgHeartRate: 142,
            maxHeartRate: 175,
            totalWorkKj: 530,
            elevationSeries: [10, 15, 20, 25, 30]
          }
        )
        expect(metadataUpdated).toBe(true)

        const fetched = await database.getFitnessFile({ id: created!.id })
        expect(fetched).toMatchObject({
          avgPower: 215,
          maxPower: 620,
          avgHeartRate: 142,
          maxHeartRate: 175,
          totalWorkKj: 530,
          elevationSeries: [10, 15, 20, 25, 30]
        })
      })

      it('keeps the map failure reason independent of the processing status', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/map-error.fit',
          fileName: 'map-error.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 2048
        })

        await database.updateFitnessFileActivityData(created!.id, {
          mapError: 'Failed to store generated route map image'
        })
        await database.updateFitnessFileProcessingStatus(
          created!.id,
          'completed'
        )

        // `completed` nulls `importError` by design; `mapError` must survive it,
        // or the activity looks finished with no trace of its missing map.
        const fetched = await database.getFitnessFile({ id: created!.id })
        expect(fetched).toMatchObject({
          processingStatus: 'completed',
          mapError: 'Failed to store generated route map image'
        })
        expect(fetched?.importError).toBeUndefined()

        await database.updateFitnessFileActivityData(created!.id, {
          mapError: null
        })
        expect(
          (await database.getFitnessFile({ id: created!.id }))?.mapError
        ).toBeUndefined()
      })

      it('caps an oversized map failure reason like the import reason', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/map-error-long.fit',
          fileName: 'map-error-long.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 2048
        })

        await database.updateFitnessFileActivityData(created!.id, {
          mapError: 'e'.repeat(5_000)
        })

        const fetched = await database.getFitnessFile({ id: created!.id })
        expect(fetched?.mapError?.length).toBeLessThanOrEqual(1_000)
      })

      it('persists moving time separately from elapsed duration', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/moving-time.tcx',
          fileName: 'moving-time.tcx',
          fileType: 'tcx',
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 4096
        })

        expect(created?.movingTimeSeconds).toBeUndefined()

        const updated = await database.updateFitnessFileActivityData(
          created!.id,
          {
            totalDistanceMeters: 31_333.8,
            totalDurationSeconds: 4_614,
            movingTimeSeconds: 4_374,
            activityType: 'Ride'
          }
        )
        expect(updated).toBe(true)

        const fetched = await database.getFitnessFile({ id: created!.id })
        expect(fetched).toMatchObject({
          totalDurationSeconds: 4_614,
          movingTimeSeconds: 4_374
        })
      })

      it('persists the email map image path alongside the map path', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/email-map.fit',
          fileName: 'email-map.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        expect(created?.mapImageEmailPath).toBeUndefined()

        await database.updateFitnessFileActivityData(created!.id, {
          hasMapData: true,
          mapImagePath: 'medias/2026-07-26/route-map.webp',
          mapImageEmailPath: 'medias/2026-07-26/route-map.jpg'
        })

        const fetched = await database.getFitnessFile({ id: created!.id })
        expect(fetched).toMatchObject({
          mapImagePath: 'medias/2026-07-26/route-map.webp',
          mapImageEmailPath: 'medias/2026-07-26/route-map.jpg'
        })

        // Reprocessing clears both, so a run that no longer produces a map does
        // not leave the previous one referenced.
        await database.updateFitnessFileActivityData(created!.id, {
          hasMapData: false,
          mapImagePath: null,
          mapImageEmailPath: null
        })

        const cleared = await database.getFitnessFile({ id: created!.id })
        expect(cleared?.mapImagePath).toBeUndefined()
        expect(cleared?.mapImageEmailPath).toBeUndefined()
      })

      it('records the failure reason and clears it once the file processes again', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/broken.tcx',
          fileName: 'broken.tcx',
          fileType: 'tcx',
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 2048
        })

        await database.updateFitnessFileProcessingStatus(
          created!.id,
          'failed',
          'Invalid TCX file structure'
        )
        const failed = await database.getFitnessFile({ id: created!.id })
        expect(failed).toMatchObject({
          processingStatus: 'failed',
          importError: 'Invalid TCX file structure'
        })

        await database.updateFitnessFileProcessingStatus(created!.id, 'pending')
        const retried = await database.getFitnessFile({ id: created!.id })
        expect(retried?.processingStatus).toBe('pending')
        expect(retried?.importError).toBeUndefined()
      })

      it('truncates an oversized failure reason', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/verbose.tcx',
          fileName: 'verbose.tcx',
          fileType: 'tcx',
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 2048
        })

        await database.updateFitnessFileProcessingStatus(
          created!.id,
          'failed',
          'e'.repeat(5_000)
        )

        const fetched = await database.getFitnessFile({ id: created!.id })
        expect(fetched?.importError).toHaveLength(
          MAX_FITNESS_IMPORT_ERROR_LENGTH
        )
      })

      it('truncates an oversized reason written through the import status too', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/verbose-import.tcx',
          fileName: 'verbose-import.tcx',
          fileType: 'tcx',
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 2048
        })

        // Both stages write importError on the same row. If only one capped, a
        // long reason would be stored in full or truncated depending on which
        // write landed last.
        await database.updateFitnessFileImportStatus(
          created!.id,
          'failed',
          'e'.repeat(5_000)
        )

        const fetched = await database.getFitnessFile({ id: created!.id })
        expect(fetched?.importError).toHaveLength(
          MAX_FITNESS_IMPORT_ERROR_LENGTH
        )
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

        await database.updateFitnessFileActivityData(created!.id, {
          activityType: 'running',
          activityStartTime: new Date()
        })
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

    describe('getActorHasFitnessData audience scoping', () => {
      // The Fitness tab on a profile is itself a disclosure: a viewer who can
      // read none of an actor's fitness posts must not be told they exist.
      const actorId = actors.pollAuthor.id
      const followersUrl = `${actorId}/followers`

      const createCompletedFile = async (name: string, statusId?: string) => {
        const created = await database.createFitnessFile({
          actorId,
          path: `fitness/audience-${name}.fit`,
          fileName: `audience-${name}.fit`,
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          statusId
        })
        await database.updateFitnessFileActivityData(created!.id, {
          activityType: 'running',
          activityStartTime: new Date()
        })
        await database.updateFitnessFileProcessingStatus(
          created!.id,
          'completed'
        )
      }

      const createNoteTo = async (
        suffix: string,
        to: string[],
        cc: string[] = []
      ) => {
        const id = `${actorId}/statuses/audience-${suffix}`
        await database.createNote({
          id,
          url: id,
          actorId,
          text: `fitness ${suffix}`,
          to,
          cc,
          createdAt: Date.now()
        })
        return id
      }

      it('only counts files attached to a status the audience can read', async () => {
        // An unattached file is the owner's alone.
        await createCompletedFile('unattached')
        expect(await database.getActorHasFitnessData({ actorId })).toBe(true)
        expect(
          await database.getActorHasFitnessData({ actorId, publicOnly: true })
        ).toBe(false)

        // A direct message to one actor reaches only that actor.
        const directStatusId = await createNoteTo('direct', [actors.primary.id])
        await createCompletedFile('direct', directStatusId)
        expect(
          await database.getActorHasFitnessData({ actorId, publicOnly: true })
        ).toBe(false)
        expect(
          await database.getActorHasFitnessData({
            actorId,
            visibleToActorId: actors.empty.id
          })
        ).toBe(false)
        expect(
          await database.getActorHasFitnessData({
            actorId,
            visibleToActorId: actors.primary.id
          })
        ).toBe(true)

        // Followers-only is visible to the followers audience, not the public.
        const followersStatusId = await createNoteTo('followers', [
          followersUrl
        ])
        await createCompletedFile('followers', followersStatusId)
        expect(
          await database.getActorHasFitnessData({ actorId, publicOnly: true })
        ).toBe(false)
        expect(
          await database.getActorHasFitnessData({
            actorId,
            visibleToActorId: actors.empty.id,
            includeFollowersOnly: true,
            followersAudience: followersUrl
          })
        ).toBe(true)

        // A public post is what makes the tab appear for everyone.
        const publicStatusId = await createNoteTo('public', [
          ACTIVITY_STREAM_PUBLIC
        ])
        await createCompletedFile('public', publicStatusId)
        expect(
          await database.getActorHasFitnessData({ actorId, publicOnly: true })
        ).toBe(true)
      })
    })

    describe('getFitnessActivityCalendarData', () => {
      beforeAll(async () => {
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
      })

      it('returns per-day aggregates grouped by date', async () => {
        const result = await database.getFitnessActivityCalendarData({
          timeZone: 'UTC',
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
          timeZone: 'UTC',
          actorId: actors.extra.id,
          startDate: new Date('2010-01-01T00:00:00.000Z').getTime(),
          endDate: new Date('2010-02-01T00:00:00.000Z').getTime()
        })

        expect(result).toEqual([])
      })

      it('filters by activityType when provided', async () => {
        const result = await database.getFitnessActivityCalendarData({
          timeZone: 'UTC',
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
          timeZone: 'UTC',
          actorId: actors.extra.id,
          startDate: new Date('2027-04-01T00:00:00.000Z').getTime(),
          endDate: new Date('2027-05-01T00:00:00.000Z').getTime()
        })

        expect(result).toEqual([])
      })
    })

    describe('fitness overview local-day windows', () => {
      // Every case seeds its own month (or year) so rows never leak into
      // another case's window: the database is shared by the whole file, and
      // `actors.extra` already holds rows in 2026 and 2027.
      const AMSTERDAM = 'Europe/Amsterdam'
      const LOS_ANGELES = 'America/Los_Angeles'
      const HOUR_MS = 60 * 60 * 1000

      const dayKey = (value: string): DateKey => {
        const key = parseDateKey(value)
        if (!key) throw new Error(`Bad date key in test: ${value}`)
        return key
      }
      const windowOf = (from: string, to: string, timeZone: string) =>
        localDayWindow(dayKey(from), dayKey(to), timeZone)
      const at = (date: string, time: string, timeZone: string) =>
        instantAtLocalWallTime(dayKey(date), time, timeZone)

      interface SeedActivity {
        startTime: number | null
        activityType?: string
        distance?: number
        duration?: number
        elevation?: number
        processingStatus?: FitnessProcessingStatus
        primary?: boolean
        deleted?: boolean
        statusId?: string
        actorId?: string
      }

      let sequence = 0
      const seedActivity = async ({
        startTime,
        activityType = 'running',
        distance = 1000,
        duration = 600,
        elevation = 10,
        processingStatus = 'completed',
        primary = true,
        deleted = false,
        statusId,
        actorId = actors.extra.id
      }: SeedActivity) => {
        sequence += 1
        const created = await database.createFitnessFile({
          actorId,
          path: `fitness/overview-window-${sequence}.fit`,
          fileName: `overview-window-${sequence}.fit`,
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 256
        })
        await database.updateFitnessFileActivityData(created!.id, {
          ...(activityType ? { activityType } : {}),
          ...(startTime === null
            ? {}
            : { activityStartTime: new Date(startTime) }),
          totalDistanceMeters: distance,
          totalDurationSeconds: duration,
          elevationGainMeters: elevation
        })
        await database.updateFitnessFileProcessingStatus(
          created!.id,
          processingStatus
        )
        if (!primary)
          await database.updateFitnessFilePrimary(created!.id, false)
        if (statusId) {
          await database.updateFitnessFileStatus(created!.id, statusId)
        }
        if (deleted) await database.deleteFitnessFile({ id: created!.id })
        return created!.id
      }

      const calendar = (
        from: string,
        to: string,
        timeZone: string,
        activityType?: string
      ) => {
        const { startMs, endMs } = windowOf(from, to, timeZone)
        return database.getFitnessActivityCalendarData({
          actorId: actors.extra.id,
          startDate: startMs,
          endDate: endMs,
          timeZone,
          activityType
        })
      }

      const readWindow = async (
        from: string,
        to: string,
        timeZone: string,
        pageSize = 50
      ) => {
        const { startMs, endMs } = windowOf(from, to, timeZone)
        const activities = []
        let offset = 0
        for (;;) {
          const page = await database.getFitnessActivitiesInWindow({
            actorId: actors.extra.id,
            startDate: startMs,
            endDate: endMs,
            limit: pageSize,
            offset
          })
          activities.push(...page.activities)
          offset += page.activities.length
          if (!page.hasMore) return activities
        }
      }

      it('keeps a missing distance, duration and elevation null in the window read', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/null-totals.fit',
          fileName: 'null-totals.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 256
        })
        await database.updateFitnessFileActivityData(created!.id, {
          activityType: 'strength',
          activityStartTime: new Date(at('2035-05-10', '09:00', AMSTERDAM))
        })
        await database.updateFitnessFileProcessingStatus(
          created!.id,
          'completed'
        )
        const rows = await readWindow('2035-05-10', '2035-05-10', AMSTERDAM)
        expect(rows).toHaveLength(1)
        expect(rows[0].totalDistanceMeters).toBeNull()
        expect(rows[0].totalDurationSeconds).toBeNull()
        expect(rows[0].elevationGainMeters).toBeNull()
      })

      it('buckets early-morning and late-night activities by the local day', async () => {
        await seedActivity({ startTime: at('2031-06-10', '00:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-06-10', '23:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-06-11', '00:00', AMSTERDAM) })

        // 00:30 Amsterdam in summer is 22:30Z the previous day.
        expect(
          new Date(at('2031-06-10', '00:30', AMSTERDAM)).toISOString()
        ).toBe('2031-06-09T22:30:00.000Z')

        const local = await calendar('2031-06-01', '2031-06-30', AMSTERDAM)
        expect(local.map((day) => [day.date, day.count])).toEqual([
          ['2031-06-10', 2],
          ['2031-06-11', 1]
        ])

        // The same rows bucketed in UTC land on different days, which is the
        // whole reason the zone has to travel with the request.
        const utc = await calendar('2031-06-01', '2031-06-30', 'UTC')
        expect(utc.map((day) => [day.date, day.count])).toEqual([
          ['2031-06-09', 1],
          ['2031-06-10', 2]
        ])
      })

      it('buckets west-of-UTC evenings on the local day, not the UTC day', async () => {
        await seedActivity({
          startTime: at('2031-07-10', '23:30', LOS_ANGELES)
        })
        await seedActivity({
          startTime: at('2031-07-11', '00:30', LOS_ANGELES)
        })

        // 23:30 Los Angeles is already the next day in UTC.
        expect(
          new Date(at('2031-07-10', '23:30', LOS_ANGELES)).toISOString()
        ).toBe('2031-07-11T06:30:00.000Z')

        const local = await calendar('2031-07-01', '2031-07-31', LOS_ANGELES)
        expect(local.map((day) => [day.date, day.count])).toEqual([
          ['2031-07-10', 1],
          ['2031-07-11', 1]
        ])
      })

      it('treats the window as half-open at the local day boundaries', async () => {
        const startOfDay = startOfLocalDay(dayKey('2031-08-10'), AMSTERDAM)
        const startOfNextDay = startOfLocalDay(dayKey('2031-08-11'), AMSTERDAM)
        await seedActivity({ startTime: startOfDay - 1 })
        await seedActivity({ startTime: startOfDay })
        await seedActivity({ startTime: startOfNextDay - 1 })
        await seedActivity({ startTime: startOfNextDay })

        const days = await calendar('2031-08-10', '2031-08-10', AMSTERDAM)
        expect(days.map((day) => [day.date, day.count])).toEqual([
          ['2031-08-10', 2]
        ])
        const rows = await readWindow('2031-08-10', '2031-08-10', AMSTERDAM)
        expect(rows.map((row) => row.startTime)).toEqual([
          startOfDay,
          startOfNextDay - 1
        ])
      })

      it('keeps spring-forward and fall-back days whole, including the repeated hour', async () => {
        const spring = windowOf('2031-03-30', '2031-03-30', AMSTERDAM)
        const fall = windowOf('2031-10-26', '2031-10-26', AMSTERDAM)
        expect((spring.endMs - spring.startMs) / HOUR_MS).toBe(23)
        expect((fall.endMs - fall.startMs) / HOUR_MS).toBe(25)

        await seedActivity({ startTime: at('2031-03-29', '23:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-03-30', '00:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-03-30', '23:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-03-31', '00:30', AMSTERDAM) })

        const firstPass = at('2031-10-26', '02:30', AMSTERDAM)
        await seedActivity({ startTime: at('2031-10-26', '00:30', AMSTERDAM) })
        await seedActivity({ startTime: firstPass })
        // The same wall-clock time an hour later: the repeated hour.
        await seedActivity({ startTime: firstPass + HOUR_MS })
        await seedActivity({ startTime: at('2031-10-26', '23:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-10-27', '00:30', AMSTERDAM) })

        const springDays = await calendar('2031-03-01', '2031-03-31', AMSTERDAM)
        expect(springDays.map((day) => [day.date, day.count])).toEqual([
          ['2031-03-29', 1],
          ['2031-03-30', 2],
          ['2031-03-31', 1]
        ])

        const fallDays = await calendar('2031-10-01', '2031-10-31', AMSTERDAM)
        expect(fallDays.map((day) => [day.date, day.count])).toEqual([
          ['2031-10-26', 4],
          ['2031-10-27', 1]
        ])

        const fallRows = await readWindow('2031-10-26', '2031-10-26', AMSTERDAM)
        expect(fallRows).toHaveLength(4)
      })

      it('buckets leap-day activities on 29 February', async () => {
        await seedActivity({ startTime: at('2032-02-28', '23:50', AMSTERDAM) })
        await seedActivity({ startTime: at('2032-02-29', '00:10', AMSTERDAM) })
        await seedActivity({ startTime: at('2032-02-29', '23:50', AMSTERDAM) })
        await seedActivity({ startTime: at('2032-03-01', '00:10', AMSTERDAM) })

        const days = await calendar('2032-02-01', '2032-03-31', AMSTERDAM)
        expect(days.map((day) => [day.date, day.count])).toEqual([
          ['2032-02-28', 1],
          ['2032-02-29', 2],
          ['2032-03-01', 1]
        ])

        const leapDay = await readWindow('2032-02-29', '2032-02-29', AMSTERDAM)
        expect(leapDay).toHaveLength(2)
      })

      it('sums distance, duration and elevation per local day', async () => {
        await seedActivity({
          startTime: at('2032-04-05', '07:00', AMSTERDAM),
          distance: 5000,
          duration: 1500,
          elevation: 40
        })
        await seedActivity({
          startTime: at('2032-04-05', '18:00', AMSTERDAM),
          distance: 12000,
          duration: 3000,
          elevation: 120
        })

        const days = await calendar('2032-04-01', '2032-04-30', AMSTERDAM)
        expect(days).toEqual([
          {
            date: '2032-04-05',
            count: 2,
            totalDistanceMeters: 17000,
            totalDurationSeconds: 4500,
            totalElevationGainMeters: 160
          }
        ])
      })

      it('paginates the window with limit+1 and reports hasMore', async () => {
        const base = at('2032-05-10', '06:00', AMSTERDAM)
        for (let index = 0; index < 5; index += 1) {
          await seedActivity({ startTime: base + index * HOUR_MS })
        }
        const { startMs, endMs } = windowOf(
          '2032-05-10',
          '2032-05-10',
          AMSTERDAM
        )
        const page = (limit: number, offset: number) =>
          database.getFitnessActivitiesInWindow({
            actorId: actors.extra.id,
            startDate: startMs,
            endDate: endMs,
            limit,
            offset
          })

        const first = await page(2, 0)
        const second = await page(2, 2)
        const third = await page(2, 4)
        expect(first.activities.map((row) => row.startTime)).toEqual([
          base,
          base + HOUR_MS
        ])
        expect(first.hasMore).toBe(true)
        expect(second.activities.map((row) => row.startTime)).toEqual([
          base + 2 * HOUR_MS,
          base + 3 * HOUR_MS
        ])
        expect(second.hasMore).toBe(true)
        expect(third.activities.map((row) => row.startTime)).toEqual([
          base + 4 * HOUR_MS
        ])
        expect(third.hasMore).toBe(false)

        // A page that ends exactly on the last row has nothing more.
        const exact = await page(5, 0)
        expect(exact.activities).toHaveLength(5)
        expect(exact.hasMore).toBe(false)
        const beyond = await page(2, 10)
        expect(beyond).toEqual({ activities: [], hasMore: false })
      })

      it('orders rows that share a start time by id so pages never repeat', async () => {
        const startTime = at('2032-05-20', '08:00', AMSTERDAM)
        const ids = [
          await seedActivity({ startTime }),
          await seedActivity({ startTime }),
          await seedActivity({ startTime })
        ]
        const rows = await readWindow('2032-05-20', '2032-05-20', AMSTERDAM, 1)
        expect(rows.map((row) => row.id)).toEqual([...ids].sort())
      })

      it('returns the fields the day details need, including a null statusId', async () => {
        const linked = await seedActivity({
          startTime: at('2032-06-01', '07:00', AMSTERDAM),
          statusId: statuses.primary.post,
          activityType: 'cycling',
          distance: 30000,
          duration: 3600,
          elevation: 250
        })
        const unlinked = await seedActivity({
          startTime: at('2032-06-01', '09:00', AMSTERDAM)
        })

        const rows = await readWindow('2032-06-01', '2032-06-01', AMSTERDAM)
        expect(rows).toHaveLength(2)
        expect(rows[0]).toMatchObject({
          id: linked,
          statusId: statuses.primary.post,
          activityType: 'cycling',
          startTime: at('2032-06-01', '07:00', AMSTERDAM),
          totalDistanceMeters: 30000,
          totalDurationSeconds: 3600,
          elevationGainMeters: 250
        })
        expect(rows[1]).toMatchObject({ id: unlinked, statusId: null })
        expect(typeof rows[0].fileName).toBe('string')
      })

      it('excludes non-primary, failed, pending, deleted and untimed files everywhere', async () => {
        const startTime = at('2032-09-10', '10:00', AMSTERDAM)
        const counted = await seedActivity({ startTime, distance: 1000 })
        await seedActivity({ startTime, primary: false, distance: 7000 })
        await seedActivity({
          startTime,
          processingStatus: 'failed',
          distance: 7000
        })
        await seedActivity({
          startTime,
          processingStatus: 'pending',
          distance: 7000
        })
        await seedActivity({ startTime, deleted: true, distance: 7000 })
        await seedActivity({ startTime: null, distance: 7000 })

        const days = await calendar('2032-09-01', '2032-09-30', AMSTERDAM)
        expect(days).toEqual([
          {
            date: '2032-09-10',
            count: 1,
            totalDistanceMeters: 1000,
            totalDurationSeconds: 600,
            totalElevationGainMeters: 10
          }
        ])

        const { startMs, endMs } = windowOf(
          '2032-09-01',
          '2032-09-30',
          AMSTERDAM
        )
        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: startMs,
          endDate: endMs
        })
        expect(summary).toEqual([
          {
            activityType: 'running',
            count: 1,
            totalDistanceMeters: 1000,
            totalDurationSeconds: 600,
            totalElevationGainMeters: 10
          }
        ])

        const rows = await readWindow('2032-09-01', '2032-09-30', AMSTERDAM)
        expect(rows.map((row) => row.id)).toEqual([counted])
      })

      it('reads only the requested actor, in the summary, calendar and day window', async () => {
        const startTime = at('2033-03-10', '10:00', AMSTERDAM)
        const mine = await seedActivity({ startTime, distance: 1000 })
        await seedActivity({
          startTime,
          distance: 7000,
          actorId: actors.primary.id
        })

        const days = await calendar('2033-03-01', '2033-03-31', AMSTERDAM)
        expect(
          days.map((day) => [day.date, day.count, day.totalDistanceMeters])
        ).toEqual([['2033-03-10', 1, 1000]])

        const { startMs, endMs } = windowOf(
          '2033-03-01',
          '2033-03-31',
          AMSTERDAM
        )
        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: startMs,
          endDate: endMs
        })
        expect(summary).toEqual([
          expect.objectContaining({ count: 1, totalDistanceMeters: 1000 })
        ])

        const rows = await readWindow('2033-03-01', '2033-03-31', AMSTERDAM)
        expect(rows.map((row) => row.id)).toEqual([mine])
      })

      it('counts untyped activities as their own group, never as the string "null"', async () => {
        await seedActivity({
          startTime: at('2032-10-05', '07:00', AMSTERDAM),
          activityType: 'running',
          distance: 4000,
          duration: 1200,
          elevation: 20
        })
        await seedActivity({
          startTime: at('2032-10-05', '12:00', AMSTERDAM),
          activityType: '',
          distance: 3000,
          duration: 900,
          elevation: 5
        })
        await seedActivity({
          startTime: at('2032-10-06', '12:00', AMSTERDAM),
          activityType: '',
          distance: 2000,
          duration: 600,
          elevation: 5
        })

        const { startMs, endMs } = windowOf(
          '2032-10-01',
          '2032-10-31',
          AMSTERDAM
        )
        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: startMs,
          endDate: endMs
        })
        expect(summary.map((row) => row.activityType)).not.toContain('null')
        expect(summary).toHaveLength(2)
        expect(summary.find((row) => row.activityType === null)).toEqual({
          activityType: null,
          count: 2,
          totalDistanceMeters: 5000,
          totalDurationSeconds: 1500,
          totalElevationGainMeters: 10
        })
        expect(
          summary.find((row) => row.activityType === 'running')
        ).toMatchObject({ count: 1, totalDistanceMeters: 4000 })

        const days = await calendar('2032-10-01', '2032-10-31', AMSTERDAM)
        expect(days.map((day) => [day.date, day.count])).toEqual([
          ['2032-10-05', 2],
          ['2032-10-06', 1]
        ])
        expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(
          summary.reduce((sum, row) => sum + row.count, 0)
        )

        const typed = await calendar(
          '2032-10-01',
          '2032-10-31',
          AMSTERDAM,
          'running'
        )
        expect(typed.map((day) => [day.date, day.count])).toEqual([
          ['2032-10-05', 1]
        ])

        const rows = await readWindow('2032-10-01', '2032-10-31', AMSTERDAM)
        expect(rows.map((row) => row.activityType)).toEqual([
          'running',
          null,
          null
        ])
      })

      describe('aggregates and day details agree', () => {
        // One fixture spanning a month, with rows near every zone's midnight,
        // untyped rows and several per day, so each zone buckets it differently.
        const FIXTURE_FROM = '2033-03-01'
        const FIXTURE_TO = '2033-03-31'

        beforeAll(async () => {
          const month = Date.UTC(2033, 2, 1)
          const hours = [0.5, 3, 7.5, 12, 16.25, 21, 22.5, 23.75]
          for (let day = 0; day < 31; day += 1) {
            for (const [index, hour] of hours.entries()) {
              // A deterministic, uneven pattern: some days empty, some busy.
              if ((day * 7 + index * 3) % 5 !== 0) continue
              await seedActivity({
                startTime: month + day * 24 * HOUR_MS + hour * HOUR_MS,
                activityType: index % 3 === 0 ? '' : 'running',
                distance: 1000 + day * 10 + index,
                duration: 600 + index * 30,
                elevation: day + index
              })
            }
          }
        })

        it.each([AMSTERDAM, LOS_ANGELES, 'Asia/Kathmandu', 'UTC'])(
          'matches the sum of the day window for every calendar day in %s',
          async (timeZone) => {
            const days = await calendar(FIXTURE_FROM, FIXTURE_TO, timeZone)
            expect(days.length).toBeGreaterThan(10)

            let windowRows = 0
            for (const day of days) {
              // Pages of two, so the agreement is also checked across pages.
              const rows = await readWindow(day.date, day.date, timeZone, 2)
              windowRows += rows.length
              expect(rows).toHaveLength(day.count)
              expect(
                rows.reduce(
                  (sum, row) => sum + (row.totalDistanceMeters ?? 0),
                  0
                )
              ).toBe(day.totalDistanceMeters)
              expect(
                rows.reduce(
                  (sum, row) => sum + (row.totalDurationSeconds ?? 0),
                  0
                )
              ).toBe(day.totalDurationSeconds)
              expect(
                rows.reduce(
                  (sum, row) => sum + (row.elevationGainMeters ?? 0),
                  0
                )
              ).toBe(day.totalElevationGainMeters)
            }

            // Reading the whole range at once finds the same rows, so no day
            // window dropped or duplicated one.
            const all = await readWindow(FIXTURE_FROM, FIXTURE_TO, timeZone)
            expect(all).toHaveLength(windowRows)
            expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(
              all.length
            )
          }
        )

        it.each([AMSTERDAM, LOS_ANGELES, 'Asia/Kathmandu'])(
          'matches the summary totals for the same range in %s',
          async (timeZone) => {
            const days = await calendar(FIXTURE_FROM, FIXTURE_TO, timeZone)
            const { startMs, endMs } = windowOf(
              FIXTURE_FROM,
              FIXTURE_TO,
              timeZone
            )
            const summary = await database.getFitnessActivitySummary({
              actorId: actors.extra.id,
              startDate: startMs,
              endDate: endMs
            })
            const sum = (values: number[]) =>
              values.reduce((total, value) => total + value, 0)

            expect(sum(summary.map((row) => row.count))).toBe(
              sum(days.map((day) => day.count))
            )
            expect(sum(summary.map((row) => row.totalDistanceMeters))).toBe(
              sum(days.map((day) => day.totalDistanceMeters))
            )
            expect(sum(summary.map((row) => row.totalDurationSeconds))).toBe(
              sum(days.map((day) => day.totalDurationSeconds))
            )
            expect(
              sum(summary.map((row) => row.totalElevationGainMeters))
            ).toBe(sum(days.map((day) => day.totalElevationGainMeters)))
            expect(summary.some((row) => row.activityType === null)).toBe(true)
          }
        )
      })

      it('rejects an unknown time zone instead of bucketing in the wrong one', async () => {
        await expect(
          database.getFitnessActivityCalendarData({
            actorId: actors.extra.id,
            startDate: 0,
            endDate: 1,
            timeZone: 'Not/AZone'
          })
        ).rejects.toThrow(RangeError)
      })

      describe('getFitnessActivityTimeBounds', () => {
        it('returns null earliest when the actor has no countable activity', async () => {
          await expect(
            database.getFitnessActivityTimeBounds({
              actorId: 'non-existent-actor-id'
            })
          ).resolves.toEqual({ earliest: null })
        })

        it('returns the earliest countable start, ignoring excluded rows', async () => {
          const longAgo = Date.UTC(1999, 0, 1)
          // None of these count, so none may become the earliest.
          await seedActivity({ startTime: longAgo, processingStatus: 'failed' })
          await seedActivity({ startTime: longAgo + HOUR_MS, primary: false })
          await seedActivity({
            startTime: longAgo + 2 * HOUR_MS,
            deleted: true
          })
          await seedActivity({ startTime: null })

          const bounds = await database.getFitnessActivityTimeBounds({
            actorId: actors.extra.id
          })
          const firstCountable = await database.getFitnessActivitiesInWindow({
            actorId: actors.extra.id,
            startDate: 0,
            endDate: Date.UTC(2100, 0, 1),
            limit: 1,
            offset: 0
          })
          expect(firstCountable.activities).toHaveLength(1)
          expect(bounds.earliest).toBe(firstCountable.activities[0].startTime)
          expect(bounds.earliest).toBeGreaterThan(longAgo + 3 * HOUR_MS)
        })
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

      it('drops the cached route with the activity and no other', async () => {
        // Two rows, because the delete has to be SCOPED: an unscoped one would
        // pass every assertion about the deleted activity while wiping the
        // whole instance's cache, and the only symptom would be the next
        // Generate quietly paying a full download-and-reparse for everyone.
        const createRouted = async (name: string) => {
          const file = await database.createFitnessFile({
            actorId: actors.extra.id,
            path: `fitness/${name}.gpx`,
            fileName: `${name}.gpx`,
            fileType: 'gpx',
            mimeType: 'application/gpx+xml',
            bytes: 2048
          })
          await database.upsertFitnessFileRoute({
            fitnessFileId: file!.id,
            actorId: actors.extra.id,
            points: [
              [1.3, 103.8],
              [1.31, 103.81]
            ],
            sourceVersion: 1
          })
          return file!.id
        }

        const deletedId = await createRouted('delete-with-route')
        const keptId = await createRouted('keep-my-route')
        expect(
          await database.getFitnessFileRoutes({
            fitnessFileIds: [deletedId, keptId]
          })
        ).toHaveLength(2)

        expect(await database.deleteFitnessFile({ id: deletedId })).toBe(true)

        const remaining = await database.getFitnessFileRoutes({
          fitnessFileIds: [deletedId, keptId]
        })
        expect(remaining.map((route) => route.fitnessFileId)).toEqual([keptId])
      })
    })

    describe('getRetriableFitnessImportBatchIds', () => {
      it('returns failed, failed-processing and stuck batch ids', async () => {
        const actorId = actors.empty.id
        const past = new Date(Date.now() - 60 * 60 * 1000)
        const future = new Date(Date.now() + 60 * 60 * 1000)

        // No fitness files yet.
        expect(
          await database.getRetriableFitnessImportBatchIds({
            actorId,
            stuckBefore: past
          })
        ).toHaveLength(0)

        // A file with no import batch is never batch-retriable.
        const orphan = await database.createFitnessFile({
          actorId,
          path: 'fitness/empty-orphan.fit',
          fileName: 'orphan.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        await database.updateFitnessFileProcessingStatus(orphan!.id, 'failed')
        expect(
          await database.getRetriableFitnessImportBatchIds({
            actorId,
            stuckBefore: past
          })
        ).toHaveLength(0)

        // A completed batch import is not retriable.
        const completed = await database.createFitnessFile({
          actorId,
          path: 'fitness/empty-completed.fit',
          fileName: 'completed.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          importBatchId: 'strava-activity:empty-ok'
        })
        await database.updateFitnessFileImportStatus(completed!.id, 'completed')
        await database.updateFitnessFileProcessingStatus(
          completed!.id,
          'completed'
        )
        expect(
          await database.getRetriableFitnessImportBatchIds({
            actorId,
            stuckBefore: past
          })
        ).toHaveLength(0)

        // A fresh `processing` batch is not stuck for a past threshold...
        const processing = await database.createFitnessFile({
          actorId,
          path: 'fitness/empty-processing.fit',
          fileName: 'processing.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          importBatchId: 'strava-activity:empty-proc'
        })
        await database.updateFitnessFileProcessingStatus(
          processing!.id,
          'processing'
        )
        expect(
          await database.getRetriableFitnessImportBatchIds({
            actorId,
            stuckBefore: past
          })
        ).toHaveLength(0)
        // ...but counts as stuck for a future threshold.
        expect(
          await database.getRetriableFitnessImportBatchIds({
            actorId,
            stuckBefore: future
          })
        ).toEqual(['strava-activity:empty-proc'])

        // A failed batch import is retriable regardless of the threshold.
        const failed = await database.createFitnessFile({
          actorId,
          path: 'fitness/empty-failed.fit',
          fileName: 'failed.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          importBatchId: 'strava-activity:empty-failed'
        })
        await database.updateFitnessFileImportStatus(
          failed!.id,
          'failed',
          'boom'
        )
        const retriable = await database.getRetriableFitnessImportBatchIds({
          actorId,
          stuckBefore: past
        })
        expect(retriable).toContain('strava-activity:empty-failed')
        // The fresh `processing` batch is still not stuck for a past threshold.
        expect(retriable).not.toContain('strava-activity:empty-proc')

        // A SIGABRT-orphaned import stranded 'pending'/'pending' with no status:
        // the importer died before it could mark 'failed'. It is retriable once
        // older than the threshold (mirrors the stuck-processing case).
        await database.createFitnessFile({
          actorId,
          path: 'fitness/empty-pending-orphan.fit',
          fileName: 'pending-orphan.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          importBatchId: 'strava-activity:empty-pending-orphan'
        })
        // Freshly created => still in-flight for a past threshold...
        expect(
          await database.getRetriableFitnessImportBatchIds({
            actorId,
            stuckBefore: past
          })
        ).not.toContain('strava-activity:empty-pending-orphan')
        // ...but retriable once older than the threshold.
        expect(
          await database.getRetriableFitnessImportBatchIds({
            actorId,
            stuckBefore: future
          })
        ).toContain('strava-activity:empty-pending-orphan')
      })
    })
    describe('getFitnessFilesByActor keyset pagination', () => {
      // Ascending, cursor-paged reads are what a whole-history scan uses; an
      // offset cannot survive one, which is the point of these tests.
      //
      // None of them assume the sort order matches the order the fixtures were
      // created in. The sort is (createdAt, id), and two files written in the
      // same millisecond — ordinary on a fast machine, and what CI hit — are
      // separated by their random uuid instead. So each test reads the
      // canonical order first and asserts against that; what is under test is
      // that paging reproduces the order, not what the order happens to be.
      const actorId = 'https://llun.test/users/keyset-scan'

      const readAllAscending = () =>
        database.getFitnessFilesByActor({
          actorId,
          orderDirection: 'asc',
          limit: 100
        })

      beforeAll(async () => {
        await database.createActor({
          actorId,
          username: 'keyset-scan',
          domain: 'llun.test',
          inboxUrl: `${actorId}/inbox`,
          followersUrl: `${actorId}/followers`,
          sharedInboxUrl: 'https://llun.test/inbox',
          publicKey: 'public-key-keyset-scan',
          privateKey: 'private-key-keyset-scan',
          createdAt: Date.now()
        })

        for (const index of [1, 2, 3, 4]) {
          await database.createFitnessFile({
            actorId,
            path: `fitness/keyset-${index}.fit`,
            fileName: `keyset-${index}.fit`,
            fileType: 'fit',
            mimeType: 'application/vnd.ant.fit',
            bytes: 1024
          })
        }
      })

      it('defaults to newest first so existing callers are unaffected', async () => {
        const ascending = await readAllAscending()
        const byDefault = await database.getFitnessFilesByActor({
          actorId,
          limit: 100
        })

        expect(byDefault.map((row) => row.id)).toEqual(
          ascending.map((row) => row.id).reverse()
        )
      })

      it('walks the whole history in ascending order without repeating a row', async () => {
        const expected = (await readAllAscending()).map((row) => row.id)
        const seen: string[] = []
        let cursor: { createdAt: number; id: string } | undefined

        // Two at a time, exactly how a checkpointing job pages.
        for (let page = 0; page < 4; page += 1) {
          const rows = await database.getFitnessFilesByActor({
            actorId,
            limit: 2,
            orderDirection: 'asc',
            afterCursor: cursor
          })
          if (rows.length === 0) break
          seen.push(...rows.map((row) => row.id))
          const last = rows[rows.length - 1]
          cursor = { createdAt: last.createdAt, id: last.id }
        }

        expect(seen).toEqual(expected)
      })

      it('does not skip a row when one behind the cursor is deleted mid-scan', async () => {
        // The failure an offset cannot avoid, and the reason this cursor
        // exists. A scan reads its first page, then a row it has already
        // passed is deleted; every row behind it shifts down one. Resuming at
        // `offset: 2` would hand back the FOURTH activity and silently drop the
        // third from the heatmap.
        const ordered = await readAllAscending()
        const firstPage = await database.getFitnessFilesByActor({
          actorId,
          limit: 2,
          orderDirection: 'asc'
        })
        const cursorRow = firstPage[firstPage.length - 1]

        await database.deleteFitnessFile({ id: firstPage[0].id })

        const withCursor = await database.getFitnessFilesByActor({
          actorId,
          limit: 2,
          orderDirection: 'asc',
          afterCursor: { createdAt: cursorRow.createdAt, id: cursorRow.id }
        })
        const withOffset = await database.getFitnessFilesByActor({
          actorId,
          limit: 2,
          offset: 2,
          orderDirection: 'asc'
        })

        expect(withCursor.map((row) => row.id)).toEqual([
          ordered[2].id,
          ordered[3].id
        ])
        // Pinned as the contrast, not as desired behaviour: the same resume
        // expressed as an offset loses the third activity.
        expect(withOffset.map((row) => row.id)).not.toContain(ordered[2].id)
      })

      it('pages through rows sharing a createdAt without skipping or repeating one', async () => {
        // An import writes a batch in one go, so a group of activities sharing
        // a createdAt to the millisecond is ordinary rather than exotic. The
        // clock is frozen to force that collision: left to real time these
        // inserts land a few milliseconds apart and the tiebreak never gets
        // exercised. Without it, a page boundary inside the group would skip a
        // row or serve it twice.
        const collisionActorId = 'https://llun.test/users/keyset-collision'
        await database.createActor({
          actorId: collisionActorId,
          username: 'keyset-collision',
          domain: 'llun.test',
          inboxUrl: `${collisionActorId}/inbox`,
          followersUrl: `${collisionActorId}/followers`,
          sharedInboxUrl: 'https://llun.test/inbox',
          publicKey: 'public-key-keyset-collision',
          privateKey: 'private-key-keyset-collision',
          createdAt: Date.now()
        })

        vi.useFakeTimers()
        vi.setSystemTime(new Date('2031-05-05T00:00:00.000Z'))
        try {
          for (const index of [1, 2, 3]) {
            await database.createFitnessFile({
              actorId: collisionActorId,
              path: `fitness/keyset-collision-${index}.fit`,
              fileName: `keyset-collision-${index}.fit`,
              fileType: 'fit',
              mimeType: 'application/vnd.ant.fit',
              bytes: 1024
            })
          }
        } finally {
          vi.useRealTimers()
        }

        const all = await database.getFitnessFilesByActor({
          actorId: collisionActorId,
          orderDirection: 'asc',
          limit: 100
        })
        expect(all).toHaveLength(3)
        // The collision the rest of this test depends on.
        expect(new Set(all.map((row) => row.createdAt)).size).toBe(1)
        expect(all.map((row) => row.id)).toEqual(
          [...all.map((r) => r.id)].sort()
        )

        // One row at a time, so every page boundary falls inside the group.
        const seen: string[] = []
        let cursor: { createdAt: number; id: string } | undefined
        for (let page = 0; page < 4; page += 1) {
          const rows = await database.getFitnessFilesByActor({
            actorId: collisionActorId,
            limit: 1,
            orderDirection: 'asc',
            afterCursor: cursor
          })
          if (rows.length === 0) break
          seen.push(rows[0].id)
          cursor = { createdAt: rows[0].createdAt, id: rows[0].id }
        }

        expect(seen).toEqual(all.map((row) => row.id))
      })

      it('ignores a cursor on a descending read', async () => {
        const rows = await database.getFitnessFilesByActor({
          actorId,
          orderDirection: 'desc',
          limit: 100
        })
        const withCursor = await database.getFitnessFilesByActor({
          actorId,
          orderDirection: 'desc',
          limit: 100,
          afterCursor: { createdAt: rows[0].createdAt, id: rows[0].id }
        })
        expect(withCursor.map((row) => row.id)).toEqual(
          rows.map((row) => row.id)
        )
      })
    })
  })
})

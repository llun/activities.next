import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  importFitnessFiles,
  importFitnessFilesJob
} from '@/lib/jobs/importFitnessFilesJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME
} from '@/lib/jobs/names'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { deleteMediaFile } from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getPublicIdTimestamp, isPublicId } from '@/lib/utils/publicId'

import { createImportFileHelpers } from './importFitnessFilesJob.testUtils'

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/fitness-files', async () => {
  const actual = await vi.importActual('@/lib/services/fitness-files')
  return {
    ...actual,
    getFitnessFileBuffer: vi.fn()
  }
})

vi.mock('@/lib/services/fitness-files/parseFitnessFile', async () => ({
  parseFitnessFile: vi.fn(),
  isParseableFitnessFileType: vi.fn().mockReturnValue(true)
}))

vi.mock('@/lib/services/medias', () => ({
  deleteMediaFile: vi.fn()
}))

const mockGetFitnessFileBuffer = getFitnessFileBuffer as jest.MockedFunction<
  typeof getFitnessFileBuffer
>
const mockParseFitnessFile = parseFitnessFile as jest.MockedFunction<
  typeof parseFitnessFile
>
const mockDeleteMediaFile = deleteMediaFile as jest.MockedFunction<
  typeof deleteMediaFile
>

describe('importFitnessFilesJob', () => {
  const database = getTestSQLDatabase()
  let actor: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()

    mockGetFitnessFileBuffer.mockResolvedValue(
      Buffer.from('fitness-file-bytes')
    )
    mockDeleteMediaFile.mockResolvedValue(true)
  })

  const { createFitnessFile, routedActivity } = createImportFileHelpers(
    database,
    () => actor
  )

  it('records a reason when status creation rejects with a non-Error', async () => {
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/non-error-throw.fit',
      fileName: 'non-error-throw.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-non-error-throw'
    })

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 1_000,
      totalDurationSeconds: 600,
      startTime: new Date('2026-01-09T00:00:00.000Z')
    })

    // The queue SDK can reject with a non-Error. `(error as Error).message` is
    // undefined for it, which writes importError as NULL and leaves the file
    // failed with no explanation.
    ;(getQueue().publish as jest.Mock).mockRejectedValueOnce('queue exploded')

    await importFitnessFilesJob(database, {
      id: 'import-job-non-error-throw',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-non-error-throw',
        fitnessFileIds: [file!.id],
        visibility: 'public'
      }
    })

    const updated = await database.getFitnessFile({ id: file!.id })
    expect(updated?.importStatus).toBe('failed')
    expect(updated?.importError).toBe('queue exploded')
  })

  it('drops a stale route map email copy when a file is re-imported', async () => {
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/reimport-email-copy.fit',
      fileName: 'reimport-email-copy.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-reimport-email-copy'
    })
    expect(file).toBeDefined()

    // A previous import of this row emailed the owner and stored a JPEG copy of
    // its map.
    await database.updateFitnessFileActivityData(file!.id, {
      hasMapData: true,
      mapImagePath: 'medias/2026-07-26/old-route-map.webp',
      mapImageEmailPath: 'medias/2026-07-26/old-route-map.jpg'
    })

    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 51.5007, lng: -0.1246 },
        { lat: 51.5033, lng: -0.1195 }
      ],
      trackPoints: [],
      totalDistanceMeters: 4_000,
      totalDurationSeconds: 1_200,
      activityType: 'running',
      startTime: new Date('2026-02-01T07:00:00.000Z')
    })

    await importFitnessFilesJob(database, {
      id: 'job-reimport-email-copy',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-reimport-email-copy',
        fitnessFileIds: [file!.id]
      }
    })

    // The reset below de-references the copy; a file that ends up non-primary
    // never reaches processFitnessFileJob to rewrite it, so the object would be
    // orphaned with nothing able to find it.
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      database,
      'medias/2026-07-26/old-route-map.jpg'
    )
    const updated = await database.getFitnessFile({ id: file!.id })
    expect(updated?.mapImagePath).toBeUndefined()
    expect(updated?.mapImageEmailPath).toBeUndefined()
  })

  describe('importing two overlapping files', () => {
    let importRun = 0
    let firstFileId: string
    let secondFileId: string
    let firstActivity: FitnessActivityData

    beforeEach(async () => {
      importRun += 1
      const batchId = `batch-overlap-${importRun}`
      const firstFile = await createFitnessFile(
        'fit',
        `fitness/import-overlap-${importRun}-a.fit`,
        batchId
      )
      const secondFile = await createFitnessFile(
        'fit',
        `fitness/import-overlap-${importRun}-b.fit`,
        batchId
      )

      expect(firstFile).toBeDefined()
      expect(secondFile).toBeDefined()
      firstFileId = firstFile!.id
      secondFileId = secondFile!.id

      firstActivity = {
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 5_000,
        totalDurationSeconds: 1_000,
        startTime: new Date('2026-01-01T00:00:00.000Z')
      }
      const secondActivity: FitnessActivityData = {
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 4_500,
        totalDurationSeconds: 1_000,
        startTime: new Date('2026-01-01T00:03:20.000Z')
      }

      mockParseFitnessFile
        .mockResolvedValueOnce(firstActivity)
        .mockResolvedValueOnce(secondActivity)

      await importFitnessFilesJob(database, {
        id: 'import-job-1',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId,
          fitnessFileIds: [firstFileId, secondFileId],
          visibility: 'public'
        }
      })
    })

    it('merges two overlapping files into one status and marks the first primary', async () => {
      const updatedFirst = await database.getFitnessFile({ id: firstFileId })
      const updatedSecond = await database.getFitnessFile({ id: secondFileId })

      expect(updatedFirst?.statusId).toBeDefined()
      expect(updatedSecond?.statusId).toBe(updatedFirst?.statusId)
      expect(updatedFirst?.isPrimary).toBe(true)
      expect(updatedSecond?.isPrimary).toBe(false)
      expect(updatedFirst?.importStatus).toBe('completed')
      expect(updatedSecond?.importStatus).toBe('completed')
      expect(updatedSecond?.processingStatus).toBe('completed')

      const status = await database.getStatus({
        statusId: updatedFirst!.statusId!,
        withReplies: false
      })
      expect(status?.to).toContain(ACTIVITY_STREAM_PUBLIC)
    })

    it('mints the status publicId from the backdated activity start time', async () => {
      const updatedFirst = await database.getFitnessFile({ id: firstFileId })
      const status = await database.getStatus({
        statusId: updatedFirst!.statusId!,
        withReplies: false
      })

      // The status URI tail is a v7 publicId minted from the (earliest,
      // backdated) activity start time, not `now` — so it sorts with the
      // activity rather than with the moment the import ran.
      expect(status?.publicId).toBeTruthy()
      expect(isPublicId(status?.publicId as string)).toBe(true)
      expect(status?.id).toBe(`${actor.id}/statuses/${status?.publicId}`)
      expect(getPublicIdTimestamp(status?.publicId as string)).toBe(
        firstActivity.startTime!.getTime()
      )
    })

    it('queues one process job for the primary file with notifyOnComplete false', async () => {
      const updatedFirst = await database.getFitnessFile({ id: firstFileId })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: expect.any(String),
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId: updatedFirst!.statusId,
          fitnessFileId: firstFileId,
          publishSendNote: false,
          // The default: this batch's publisher did not opt in, so the import
          // stays silent even though the status is brand new.
          notifyOnComplete: false
        }
      })
    })
  })

  it('keeps the post off the public timeline when the publisher omits visibility', async () => {
    const file = await createFitnessFile(
      'fit',
      'fitness/import-no-visibility.fit',
      'batch-no-visibility'
    )
    mockParseFitnessFile.mockResolvedValueOnce(routedActivity)

    await importFitnessFilesJob(database, {
      id: 'import-job-no-visibility',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-no-visibility',
        fitnessFileIds: [file!.id]
      }
    })

    const updated = await database.getFitnessFile({ id: file!.id })
    const status = await database.getStatus({
      statusId: updated!.statusId!,
      withReplies: false
    })
    expect(status).not.toBeNull()
    expect(status?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
    expect(status?.cc).not.toContain(ACTIVITY_STREAM_PUBLIC)
  })

  it('stamps the status at import time when the caller opts in', async () => {
    // The Strava webhook's case: the ride finished minutes ago and the post is
    // the news of it, so backdating to the start time would file it below
    // everything published while the ride was still going.
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-post-time.fit',
      fileName: 'import-post-time.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-post-time'
    })

    const activityStartTime = new Date('2026-01-01T00:00:00.000Z')
    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 5_000,
      totalDurationSeconds: 1_000,
      startTime: activityStartTime
    })

    // Pinned rather than asserted against a window between two real Date.now()
    // reads: a window only proves the stamp is not the activity start, and it
    // fails spuriously if the wall clock steps backwards mid-test. `toFake:
    // ['Date']` leaves timers real so the database round-trips still settle.
    const importedAt = Date.parse('2026-06-01T09:15:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(importedAt))
      await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'batch-post-time',
        fitnessFileIds: [file!.id],
        visibility: 'public',
        postAtImportTime: true
      })
    } finally {
      vi.useRealTimers()
    }

    const imported = await database.getFitnessFile({ id: file!.id })
    const status = await database.getStatus({
      statusId: imported!.statusId as string,
      withReplies: false
    })

    expect(status?.createdAt).toBe(importedAt)
    // The URI tail is minted from the same stamp, so the post sorts where it
    // reads rather than back at the activity.
    expect(getPublicIdTimestamp(status?.publicId as string)).toBe(importedAt)
    // The recorded start time is untouched — every fitness surface reads the
    // activity's date from the file, not from the post.
    expect(imported?.activityStartTime).toBe(activityStartTime.getTime())
  })

  it('keeps the existing post stamp when an opt-in import merges into it', async () => {
    // The second device's upload of the same ride. The sibling's post is
    // already published and may already have federated, so re-stamping it would
    // jump the ride back to the top of every follower's timeline.
    const firstFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/merge-post-time-a.fit',
      fileName: 'merge-post-time-a.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-merge-post-time'
    })
    const secondFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/merge-post-time-b.fit',
      fileName: 'merge-post-time-b.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-merge-post-time'
    })

    const activity: FitnessActivityData = {
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 5_000,
      totalDurationSeconds: 1_000,
      startTime: new Date('2026-03-02T06:00:00.000Z')
    }

    const firstImportedAt = Date.parse('2026-03-02T07:30:00.000Z')
    mockParseFitnessFile.mockResolvedValueOnce(activity)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(firstImportedAt))
      await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'batch-merge-post-time',
        fitnessFileIds: [firstFile!.id],
        visibility: 'public',
        postAtImportTime: true
      })

      // An hour later, the sibling arrives and merges into the same post.
      vi.setSystemTime(new Date(firstImportedAt + 60 * 60 * 1000))
      mockParseFitnessFile.mockResolvedValueOnce(activity)
      await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'batch-merge-post-time',
        fitnessFileIds: [secondFile!.id],
        overlapFitnessFileIds: [firstFile!.id],
        visibility: 'public',
        postAtImportTime: true
      })
    } finally {
      vi.useRealTimers()
    }

    const mergedFirst = await database.getFitnessFile({ id: firstFile!.id })
    const mergedSecond = await database.getFitnessFile({ id: secondFile!.id })
    expect(mergedSecond?.statusId).toBe(mergedFirst?.statusId)

    const status = await database.getStatus({
      statusId: mergedFirst!.statusId as string,
      withReplies: false
    })
    expect(status?.createdAt).toBe(firstImportedAt)
  })

  it('reuses existing status when import job is retried', async () => {
    const firstFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/retry-overlap-a.fit',
      fileName: 'retry-overlap-a.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-retry-idempotent'
    })
    const secondFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/retry-overlap-b.fit',
      fileName: 'retry-overlap-b.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-retry-idempotent'
    })

    expect(firstFile).toBeDefined()
    expect(secondFile).toBeDefined()

    const firstActivity: FitnessActivityData = {
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 5_000,
      totalDurationSeconds: 1_000,
      startTime: new Date('2026-01-03T00:00:00.000Z')
    }
    const secondActivity: FitnessActivityData = {
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 4_500,
      totalDurationSeconds: 1_000,
      startTime: new Date('2026-01-03T00:03:20.000Z')
    }

    mockParseFitnessFile
      .mockResolvedValueOnce(firstActivity)
      .mockResolvedValueOnce(secondActivity)

    await importFitnessFilesJob(database, {
      id: 'import-job-retry-1',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-retry-idempotent',
        fitnessFileIds: [firstFile!.id, secondFile!.id],
        visibility: 'public'
      }
    })

    const afterFirstRun = await database.getFitnessFile({ id: firstFile!.id })
    const statusId = afterFirstRun?.statusId
    expect(statusId).toBeDefined()

    const publishMock = getQueue().publish as jest.Mock
    publishMock.mockClear()

    mockParseFitnessFile
      .mockResolvedValueOnce(firstActivity)
      .mockResolvedValueOnce(secondActivity)

    await importFitnessFilesJob(database, {
      id: 'import-job-retry-2',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-retry-idempotent',
        fitnessFileIds: [firstFile!.id, secondFile!.id],
        visibility: 'public'
      }
    })

    const firstAfterRetry = await database.getFitnessFile({ id: firstFile!.id })
    const secondAfterRetry = await database.getFitnessFile({
      id: secondFile!.id
    })

    expect(firstAfterRetry?.statusId).toBe(statusId)
    expect(secondAfterRetry?.statusId).toBe(statusId)
    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(publishMock).toHaveBeenCalledWith({
      id: expect.any(String),
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId,
        fitnessFileId: firstFile!.id,
        publishSendNote: false,
        notifyOnComplete: false
      }
    })
  })

  it('uses overlap context to attach retried files to an existing status', async () => {
    const existingFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/overlap-context-existing.fit',
      fileName: 'overlap-context-existing.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-overlap-context'
    })
    const retriedFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/overlap-context-retried.fit',
      fileName: 'overlap-context-retried.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-overlap-context'
    })

    expect(existingFile).toBeDefined()
    expect(retriedFile).toBeDefined()

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 5_000,
      totalDurationSeconds: 1_000,
      startTime: new Date('2026-01-06T00:00:00.000Z')
    })

    await importFitnessFilesJob(database, {
      id: 'import-job-overlap-context-initial',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-overlap-context',
        fitnessFileIds: [existingFile!.id],
        visibility: 'public'
      }
    })

    const existingAfterInitialImport = await database.getFitnessFile({
      id: existingFile!.id
    })
    const existingStatusId = existingAfterInitialImport?.statusId
    expect(existingStatusId).toBeDefined()

    await database.updateFitnessFileProcessingStatus(
      existingFile!.id,
      'completed'
    )

    const publishMock = getQueue().publish as jest.Mock
    publishMock.mockClear()

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 4_000,
      totalDurationSeconds: 900,
      startTime: new Date('2026-01-06T00:03:00.000Z')
    })

    await importFitnessFilesJob(database, {
      id: 'import-job-overlap-context-retry',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-overlap-context',
        fitnessFileIds: [retriedFile!.id],
        overlapFitnessFileIds: [existingFile!.id],
        visibility: 'public'
      }
    })

    const existingAfterRetry = await database.getFitnessFile({
      id: existingFile!.id
    })
    const retriedAfterRetry = await database.getFitnessFile({
      id: retriedFile!.id
    })

    expect(existingAfterRetry?.statusId).toBe(existingStatusId)
    expect(existingAfterRetry?.isPrimary).toBe(true)
    expect(existingAfterRetry?.processingStatus).toBe('completed')

    expect(retriedAfterRetry?.statusId).toBe(existingStatusId)
    expect(retriedAfterRetry?.isPrimary).toBe(false)
    expect(retriedAfterRetry?.importStatus).toBe('completed')
    expect(retriedAfterRetry?.processingStatus).toBe('completed')
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('deletes newly created status when import publish fails', async () => {
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-publish-fail.fit',
      fileName: 'import-publish-fail.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-publish-fail'
    })

    expect(file).toBeDefined()

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 3_000,
      totalDurationSeconds: 1_200,
      startTime: new Date('2026-01-04T00:00:00.000Z')
    })

    const publishMock = getQueue().publish as jest.Mock
    publishMock.mockRejectedValueOnce(new Error('queue unavailable'))

    await importFitnessFilesJob(database, {
      id: 'import-job-publish-fail',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-publish-fail',
        fitnessFileIds: [file!.id],
        visibility: 'public'
      }
    })

    const publishedJob = publishMock.mock.calls[0]?.[0] as
      { data: { statusId: string } } | undefined
    const createdStatusId = publishedJob?.data.statusId
    expect(createdStatusId).toBeDefined()

    const updated = await database.getFitnessFile({ id: file!.id })
    expect(updated?.statusId).toBeUndefined()
    expect(updated?.importStatus).toBe('failed')
    expect(updated?.processingStatus).toBe('failed')

    const status = await database.getStatus({
      statusId: createdStatusId!,
      withReplies: false
    })
    expect(status).toBeNull()
  })

  it('marks files as failed when actor is missing', async () => {
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-missing-actor.fit',
      fileName: 'import-missing-actor.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-missing-actor'
    })

    expect(file).toBeDefined()

    await importFitnessFilesJob(database, {
      id: 'import-job-missing-actor',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: `${actor.id}-missing`,
        batchId: 'batch-missing-actor',
        fitnessFileIds: [file!.id],
        visibility: 'public'
      }
    })

    const updated = await database.getFitnessFile({ id: file!.id })
    expect(updated?.importStatus).toBe('failed')
    expect(updated?.processingStatus).toBe('failed')
    expect(updated?.importError).toBe('Actor not found for fitness import')
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('marks missing target file ids as failed', async () => {
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-existing.fit',
      fileName: 'import-existing.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-missing-file-id'
    })

    expect(file).toBeDefined()

    const missingFileId = 'fitness-file-missing-id'
    const importStatusSpy = vi.spyOn(database, 'updateFitnessFileImportStatus')
    const processingStatusSpy = vi.spyOn(
      database,
      'updateFitnessFileProcessingStatus'
    )

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 2_000,
      totalDurationSeconds: 900,
      startTime: new Date('2026-01-07T00:00:00.000Z')
    })

    await importFitnessFilesJob(database, {
      id: 'import-job-missing-file-id',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-missing-file-id',
        fitnessFileIds: [missingFileId, file!.id],
        visibility: 'public'
      }
    })

    expect(importStatusSpy).toHaveBeenCalledWith(
      missingFileId,
      'failed',
      'Fitness file missing during import'
    )
    // Both writes touch importError on the same row, so they must carry the same
    // reason — otherwise whichever lands last decides what the file says.
    expect(processingStatusSpy).toHaveBeenCalledWith(
      missingFileId,
      'failed',
      'Fitness file missing during import'
    )

    const updated = await database.getFitnessFile({ id: file!.id })
    expect(updated?.importStatus).toBe('completed')
    expect(updated?.statusId).toBeDefined()
  })

  it('marks parse failures and still processes valid files', async () => {
    const failedFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-fail.fit',
      fileName: 'import-fail.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-fail'
    })
    const successFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-success.fit',
      fileName: 'import-success.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-fail'
    })

    mockParseFitnessFile
      .mockRejectedValueOnce(new Error('invalid fit file'))
      .mockResolvedValueOnce({
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 2_000,
        totalDurationSeconds: 900,
        startTime: new Date('2026-01-02T00:00:00.000Z')
      })

    await importFitnessFilesJob(database, {
      id: 'import-job-2',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-fail',
        fitnessFileIds: [failedFile!.id, successFile!.id],
        visibility: 'public'
      }
    })

    const failed = await database.getFitnessFile({ id: failedFile!.id })
    const success = await database.getFitnessFile({ id: successFile!.id })

    expect(failed?.importStatus).toBe('failed')
    expect(failed?.importError).toContain('invalid fit file')
    expect(failed?.statusId).toBeUndefined()

    expect(success?.importStatus).toBe('completed')
    expect(success?.statusId).toBeDefined()
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
  })
})

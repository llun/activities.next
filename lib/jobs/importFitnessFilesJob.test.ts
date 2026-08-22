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
    expect(updated?.mapImageEmailPath).toBeUndefined()
  })

  it('creates local-only merged status, marks primary, and queues processing', async () => {
    const firstFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-overlap-a.fit',
      fileName: 'import-overlap-a.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-overlap'
    })
    const secondFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-overlap-b.fit',
      fileName: 'import-overlap-b.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-overlap'
    })

    expect(firstFile).toBeDefined()
    expect(secondFile).toBeDefined()

    const firstActivity: FitnessActivityData = {
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
        batchId: 'batch-overlap',
        fitnessFileIds: [firstFile!.id, secondFile!.id],
        visibility: 'public'
      }
    })

    const updatedFirst = await database.getFitnessFile({ id: firstFile!.id })
    const updatedSecond = await database.getFitnessFile({ id: secondFile!.id })

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

    // The status URI tail is a v7 publicId minted from the (earliest,
    // backdated) activity start time, not `now` — so it sorts with the
    // activity rather than with the moment the import ran.
    expect(status?.publicId).toBeTruthy()
    expect(isPublicId(status?.publicId as string)).toBe(true)
    expect(status?.id).toBe(`${actor.id}/statuses/${status?.publicId}`)
    expect(getPublicIdTimestamp(status?.publicId as string)).toBe(
      firstActivity.startTime!.getTime()
    )

    expect(getQueue().publish).toHaveBeenCalledTimes(1)
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId: updatedFirst!.statusId,
        fitnessFileId: firstFile!.id,
        publishSendNote: false,
        // The default: this batch's publisher did not opt in, so the import
        // stays silent even though the status is brand new.
        notifyOnComplete: false
      }
    })
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

  it('prefers outdoor file (with coordinates) as primary when merging indoor and outdoor cycling', async () => {
    const indoorFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/indoor-cycling.fit',
      fileName: 'indoor-cycling.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-indoor-outdoor'
    })
    const outdoorFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/outdoor-cycling.fit',
      fileName: 'outdoor-cycling.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-indoor-outdoor'
    })

    expect(indoorFile).toBeDefined()
    expect(outdoorFile).toBeDefined()

    const indoorActivity: FitnessActivityData = {
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 20_000,
      totalDurationSeconds: 3_600,
      startTime: new Date('2026-02-01T08:00:00.000Z')
    }
    const outdoorActivity: FitnessActivityData = {
      coordinates: [
        { lat: 13.7563, lng: 100.5018 },
        { lat: 13.76, lng: 100.505 }
      ],
      trackPoints: [],
      totalDistanceMeters: 18_000,
      totalDurationSeconds: 3_000,
      startTime: new Date('2026-02-01T08:01:00.000Z')
    }

    mockParseFitnessFile
      .mockResolvedValueOnce(indoorActivity)
      .mockResolvedValueOnce(outdoorActivity)

    await importFitnessFilesJob(database, {
      id: 'import-job-indoor-outdoor',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-indoor-outdoor',
        fitnessFileIds: [indoorFile!.id, outdoorFile!.id],
        visibility: 'public'
      }
    })

    const updatedIndoor = await database.getFitnessFile({ id: indoorFile!.id })
    const updatedOutdoor = await database.getFitnessFile({
      id: outdoorFile!.id
    })

    expect(updatedIndoor?.statusId).toBeDefined()
    expect(updatedOutdoor?.statusId).toBe(updatedIndoor?.statusId)
    expect(updatedOutdoor?.isPrimary).toBe(true)
    expect(updatedIndoor?.isPrimary).toBe(false)

    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: expect.objectContaining({ fitnessFileId: outdoorFile!.id })
      })
    )
  })

  it('picks the longest outdoor file as primary when multiple outdoor cycling files are merged', async () => {
    const shorterOutdoor = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/outdoor-short.fit',
      fileName: 'outdoor-short.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-multi-outdoor'
    })
    const longerOutdoor = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/outdoor-long.fit',
      fileName: 'outdoor-long.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-multi-outdoor'
    })

    expect(shorterOutdoor).toBeDefined()
    expect(longerOutdoor).toBeDefined()

    const shorterActivity: FitnessActivityData = {
      coordinates: [
        { lat: 13.7563, lng: 100.5018 },
        { lat: 13.757, lng: 100.5025 }
      ],
      trackPoints: [],
      totalDistanceMeters: 10_000,
      totalDurationSeconds: 1_800,
      startTime: new Date('2026-02-02T07:00:00.000Z')
    }
    const longerActivity: FitnessActivityData = {
      coordinates: [
        { lat: 13.7563, lng: 100.5018 },
        { lat: 13.76, lng: 100.508 }
      ],
      trackPoints: [],
      totalDistanceMeters: 30_000,
      totalDurationSeconds: 5_400,
      startTime: new Date('2026-02-02T07:01:00.000Z')
    }

    mockParseFitnessFile
      .mockResolvedValueOnce(shorterActivity)
      .mockResolvedValueOnce(longerActivity)

    await importFitnessFilesJob(database, {
      id: 'import-job-multi-outdoor',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-multi-outdoor',
        fitnessFileIds: [shorterOutdoor!.id, longerOutdoor!.id],
        visibility: 'public'
      }
    })

    const updatedShorter = await database.getFitnessFile({
      id: shorterOutdoor!.id
    })
    const updatedLonger = await database.getFitnessFile({
      id: longerOutdoor!.id
    })

    expect(updatedShorter?.statusId).toBeDefined()
    expect(updatedLonger?.statusId).toBe(updatedShorter?.statusId)
    expect(updatedLonger?.isPrimary).toBe(true)
    expect(updatedShorter?.isPrimary).toBe(false)

    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: expect.objectContaining({ fitnessFileId: longerOutdoor!.id })
      })
    )
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

  describe('import notification opt-in', () => {
    const createFile = async (name: string) => {
      const file = await database.createFitnessFile({
        actorId: actor.id,
        path: `fitness/${name}.fit`,
        fileName: `${name}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024,
        importBatchId: 'batch-notify-optin'
      })
      return file!.id
    }

    const stubParse = (count: number) => {
      for (let index = 0; index < count; index += 1) {
        mockParseFitnessFile.mockResolvedValueOnce({
          coordinates: [],
          trackPoints: [],
          totalDistanceMeters: 5_000 + index,
          totalDurationSeconds: 1_500 + index,
          // Distinct start times so the files do not merge as one overlapping
          // activity — the point is several separate imports in one batch.
          startTime: new Date(Date.UTC(2026, 0, 2 + index))
        })
      }
    }

    it('stays silent for a bulk batch that did not opt in', async () => {
      // This job is the funnel for every bulk import: the Strava archive
      // walker, the multi-file upload endpoint, retry-all, the recovery
      // scripts. Each activity in a batch gets its own brand-new status, so
      // inferring "notify" from that alone would mail once per activity — a
      // 500-ride archive import would send 500 emails.
      const fitnessFileIds = await Promise.all([
        createFile('bulk-a'),
        createFile('bulk-b'),
        createFile('bulk-c')
      ])
      stubParse(3)

      await importFitnessFilesJob(database, {
        id: 'job-bulk-silent',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-notify-optin',
          fitnessFileIds
        }
      })

      const publishes = (getQueue().publish as jest.Mock).mock.calls
        .map(([message]) => message)
        .filter((message) => message.name === PROCESS_FITNESS_FILE_JOB_NAME)
      expect(publishes.length).toBeGreaterThan(0)
      for (const message of publishes) {
        expect(message.data.notifyOnComplete).toBe(false)
      }
    })

    it('notifies when the publisher opted in and the status is new', async () => {
      const fitnessFileIds = [await createFile('single-opt-in')]
      stubParse(1)

      await importFitnessFilesJob(database, {
        id: 'job-single-notify',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-notify-optin-single',
          fitnessFileIds,
          notifyOnComplete: true
        }
      })

      const publish = (getQueue().publish as jest.Mock).mock.calls
        .map(([message]) => message)
        .find((message) => message.name === PROCESS_FITNESS_FILE_JOB_NAME)
      expect(publish?.data.notifyOnComplete).toBe(true)
    })
  })

  describe('federation opt-in', () => {
    const createFile = async (name: string) => {
      const file = await database.createFitnessFile({
        actorId: actor.id,
        path: `fitness/${name}.fit`,
        fileName: `${name}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024,
        importBatchId: 'batch-federation-optin'
      })
      return file!.id
    }

    const stubParse = (startDay: number) => {
      mockParseFitnessFile.mockResolvedValueOnce({
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 9_000,
        totalDurationSeconds: 2_400,
        startTime: new Date(Date.UTC(2026, 2, startDay))
      })
    }

    const getProcessJobs = () =>
      (getQueue().publish as jest.Mock).mock.calls
        .map(([message]) => message)
        .filter((message) => message.name === PROCESS_FITNESS_FILE_JOB_NAME)

    it.each([
      {
        description: 'stays local without an opt-in',
        requested: undefined,
        expected: false
      },
      {
        description: 'federates on opt-in',
        requested: true,
        expected: true
      }
    ])('$description', async ({ requested, expected }) => {
      const fitnessFileIds = [await createFile(`optin-${String(requested)}`)]
      stubParse(3)

      await importFitnessFilesJob(database, {
        id: `job-federation-${String(requested)}`,
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-federation-optin',
          fitnessFileIds,
          ...(requested === undefined ? {} : { publishSendNote: requested })
        }
      })

      const publish = getProcessJobs().at(-1)
      expect(publish?.data.publishSendNote).toBe(expected)
    })

    it('does not federate again when the import re-runs over an existing status', async () => {
      // Retries and the recovery scripts re-drive this job over statuses that
      // are already live. Their Create has been delivered, so a second one
      // would post the same ride to every follower twice.
      const fitnessFileIds = [await createFile('rerun')]
      stubParse(6)

      await importFitnessFilesJob(database, {
        id: 'job-federation-first',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-federation-optin',
          fitnessFileIds,
          publishSendNote: true
        }
      })
      expect(getProcessJobs().at(-1)?.data.publishSendNote).toBe(true)

      stubParse(6)
      await importFitnessFilesJob(database, {
        id: 'job-federation-rerun',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-federation-optin',
          fitnessFileIds,
          publishSendNote: true
        }
      })

      expect(getProcessJobs().at(-1)?.data.publishSendNote).toBe(false)
    })

    it('returns the process job instead of publishing it when deferred', async () => {
      const fitnessFileIds = [await createFile('deferred')]
      stubParse(8)

      const groups = await importFitnessFiles(
        database,
        {
          actorId: actor.id,
          batchId: 'batch-federation-optin',
          fitnessFileIds,
          publishSendNote: true
        },
        { deferProcessJobPublishes: true }
      )

      expect(getProcessJobs()).toHaveLength(0)
      expect(groups).toHaveLength(1)
      expect(groups[0].statusCreated).toBe(true)
      expect(groups[0].processJob).toEqual(
        expect.objectContaining({
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: expect.objectContaining({
            statusId: groups[0].statusId,
            fitnessFileId: fitnessFileIds[0],
            publishSendNote: true
          })
        })
      )
    })
  })

  describe('recording device', () => {
    it('resolves the device from the parsed file and links the activity', async () => {
      const file = await database.createFitnessFile({
        actorId: actor.id,
        path: 'fitness/device-link.fit',
        fileName: 'device-link.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024,
        importBatchId: 'batch-device-link'
      })

      mockParseFitnessFile.mockResolvedValue({
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 20_000,
        totalDurationSeconds: 3_600,
        startTime: new Date('2026-01-09T00:00:00.000Z'),
        deviceName: 'Hammerhead Karoo 3',
        deviceManufacturer: 'hammerhead'
      })

      await importFitnessFilesJob(database, {
        id: 'import-job-device-link',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-device-link',
          fitnessFileIds: [file!.id],
          visibility: 'public'
        }
      })

      const updated = await database.getFitnessFile({ id: file!.id })
      expect(updated?.deviceGearId).toBeDefined()

      const device = await database.getFitnessGear({
        id: updated?.deviceGearId as string,
        actorId: actor.id
      })
      expect(device).toMatchObject({
        kind: 'device',
        brand: 'Hammerhead',
        model: 'Karoo 3',
        deviceKey: 'name:hammerhead karoo 3'
      })

      await database.deleteFitnessGear({
        id: device!.id,
        actorId: actor.id
      })
    })

    it('links nothing when the parsed file names no device', async () => {
      const file = await database.createFitnessFile({
        actorId: actor.id,
        path: 'fitness/device-none.fit',
        fileName: 'device-none.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024,
        importBatchId: 'batch-device-none'
      })

      mockParseFitnessFile.mockResolvedValue({
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 20_000,
        totalDurationSeconds: 3_600,
        startTime: new Date('2026-01-09T00:00:00.000Z')
      })

      await importFitnessFilesJob(database, {
        id: 'import-job-device-none',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-device-none',
          fitnessFileIds: [file!.id],
          visibility: 'public'
        }
      })

      const updated = await database.getFitnessFile({ id: file!.id })
      expect(updated?.deviceGearId).toBeUndefined()
    })
  })
})

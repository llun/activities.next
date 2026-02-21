import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME
} from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('@/lib/services/fitness-files', () => {
  const actual = jest.requireActual('../services/fitness-files')
  return {
    ...actual,
    getFitnessFile: jest.fn()
  }
})

jest.mock('@/lib/services/fitness-files/parseFitnessFile', () => ({
  parseFitnessFile: jest.fn()
}))

const mockGetFitnessFile = getFitnessFile as jest.MockedFunction<
  typeof getFitnessFile
>
const mockParseFitnessFile = parseFitnessFile as jest.MockedFunction<
  typeof parseFitnessFile
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
    jest.clearAllMocks()

    mockGetFitnessFile.mockResolvedValue({
      type: 'buffer',
      buffer: Buffer.from('fitness-file-bytes'),
      contentType: 'application/vnd.ant.fit'
    })
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

    expect(getQueue().publish).toHaveBeenCalledTimes(1)
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: expect.any(String),
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId: updatedFirst!.statusId,
        fitnessFileId: firstFile!.id,
        publishSendNote: false
      }
    })
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
        publishSendNote: false
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
      | { data: { statusId: string } }
      | undefined
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

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
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

  const { createFitnessFile, importWithActivity } = createImportFileHelpers(
    database,
    () => actor
  )

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

  it('opts in to promoting a richer Wahoo FIT file while preserving the existing status', async () => {
    const tcxFile = await createFitnessFile(
      'tcx',
      'fitness/wahoo-upgrade-tcx.tcx',
      'batch-wahoo-upgrade'
    )
    const wahooFile = await createFitnessFile(
      'fit',
      'fitness/wahoo-upgrade-fit.fit',
      'batch-wahoo-upgrade'
    )
    await importWithActivity(tcxFile!.id, 'wahoo-upgrade-initial')
    const existing = await database.getFitnessFile({ id: tcxFile!.id })
    ;(getQueue().publish as jest.Mock).mockClear()

    const groups = await importWithActivity(
      wahooFile!.id,
      'wahoo-upgrade-second-device',
      {
        overlapFitnessFileIds: [tcxFile!.id],
        notifyOnComplete: true,
        publishSendNote: true,
        preferRicherPrimary: true
      }
    )

    const upgradedTcx = await database.getFitnessFile({ id: tcxFile!.id })
    const upgradedWahoo = await database.getFitnessFile({ id: wahooFile!.id })
    expect(upgradedWahoo?.statusId).toBe(existing?.statusId)
    expect(upgradedWahoo?.isPrimary).toBe(true)
    expect(upgradedTcx?.isPrimary).toBe(false)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.statusCreated).toBe(false)
    expect(groups[0]?.primaryFitnessFileId).toBe(wahooFile!.id)
    expect(groups[0]?.processJob?.data).toEqual(
      expect.objectContaining({
        fitnessFileId: wahooFile!.id,
        publishSendNote: false,
        notifyOnComplete: false
      })
    )
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing TCX primary when richer-primary preference is absent', async () => {
    const tcxFile = await createFitnessFile(
      'tcx',
      'fitness/wahoo-no-upgrade-tcx.tcx',
      'batch-wahoo-no-upgrade'
    )
    const wahooFile = await createFitnessFile(
      'fit',
      'fitness/wahoo-no-upgrade-fit.fit',
      'batch-wahoo-no-upgrade'
    )
    await importWithActivity(tcxFile!.id, 'wahoo-no-upgrade-initial')
    const existing = await database.getFitnessFile({ id: tcxFile!.id })
    ;(getQueue().publish as jest.Mock).mockClear()

    const groups = await importWithActivity(
      wahooFile!.id,
      'wahoo-no-upgrade-second-device',
      { overlapFitnessFileIds: [tcxFile!.id] }
    )

    const keptTcx = await database.getFitnessFile({ id: tcxFile!.id })
    const keptWahoo = await database.getFitnessFile({ id: wahooFile!.id })
    expect(keptWahoo?.statusId).toBe(existing?.statusId)
    expect(keptTcx?.isPrimary).toBe(true)
    expect(keptWahoo?.isPrimary).toBe(false)
    expect(groups[0]?.primaryFitnessFileId).toBe(tcxFile!.id)
    expect(groups[0]?.processJob).toBeNull()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('replaces an earlier Wahoo revision in the same status when requested', async () => {
    const earlierWahooFile = await createFitnessFile(
      'fit',
      'fitness/wahoo-revision-earlier.fit',
      'batch-wahoo-revision'
    )
    const latestWahooFile = await createFitnessFile(
      'fit',
      'fitness/wahoo-revision-latest.fit',
      'batch-wahoo-revision'
    )
    await importWithActivity(earlierWahooFile!.id, 'wahoo-revision-initial')
    const existing = await database.getFitnessFile({
      id: earlierWahooFile!.id
    })
    const gear = await database.createFitnessGear({
      actorId: actor.id,
      kind: 'bike',
      name: 'Wahoo revision bike'
    })
    await database.setFitnessFileGear({
      actorId: actor.id,
      fitnessFileId: earlierWahooFile!.id,
      gearId: gear.id
    })
    await database.updateFitnessFileActivityData(earlierWahooFile!.id, {
      hasMapData: true,
      mapImagePath: 'medias/2026-07-26/wahoo-old-route-map.webp',
      mapImageEmailPath: 'medias/2026-07-26/wahoo-old-route-map.jpg'
    })
    await database.createAttachment({
      actorId: actor.id,
      statusId: existing!.statusId!,
      mediaType: 'image/jpeg',
      url: 'https://example.com/user-attachment.jpg',
      width: 320,
      height: 240,
      name: 'user-attachment.jpg'
    })
    ;(getQueue().publish as jest.Mock).mockClear()

    const groups = await importWithActivity(
      latestWahooFile!.id,
      'wahoo-revision-update',
      {
        overlapFitnessFileIds: [earlierWahooFile!.id],
        notifyOnComplete: true,
        publishSendNote: true,
        replacePrimaryFileId: earlierWahooFile!.id
      }
    )

    const earlier = await database.getFitnessFile({
      id: earlierWahooFile!.id
    })
    const latest = await database.getFitnessFile({ id: latestWahooFile!.id })
    expect(latest?.statusId).toBe(existing?.statusId)
    expect(latest?.isPrimary).toBe(true)
    expect(latest?.gearId).toBe(gear.id)
    expect(latest?.hasMapData).toBe(true)
    expect(latest?.mapImagePath).toBe(
      'medias/2026-07-26/wahoo-old-route-map.webp'
    )
    expect(latest?.mapImageEmailPath).toBe(
      'medias/2026-07-26/wahoo-old-route-map.jpg'
    )
    expect(earlier?.isPrimary).toBe(false)
    expect(earlier?.mapImagePath).toBeUndefined()
    expect(earlier?.mapImageEmailPath).toBeUndefined()
    await expect(
      database.getAttachments({ statusId: existing!.statusId! })
    ).resolves.toMatchObject([
      expect.objectContaining({
        url: 'https://example.com/user-attachment.jpg'
      })
    ])
    expect(groups[0]?.statusCreated).toBe(false)
    expect(groups[0]?.primaryFitnessFileId).toBe(latestWahooFile!.id)
    expect(groups[0]?.processJob?.data).toEqual(
      expect.objectContaining({
        fitnessFileId: latestWahooFile!.id,
        publishSendNote: false,
        notifyOnComplete: false
      })
    )
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
  })

  it('preserves the promoted generated map when retrying after a process job publish failure', async () => {
    const earlier = await createFitnessFile(
      'fit',
      'fitness/wahoo-map-retry-earlier.fit',
      'batch-wahoo-map-retry'
    )
    const promoted = await createFitnessFile(
      'fit',
      'fitness/wahoo-map-retry-promoted.fit',
      'batch-wahoo-map-retry'
    )
    await importWithActivity(earlier!.id, 'wahoo-map-retry-initial')
    const existing = await database.getFitnessFile({ id: earlier!.id })
    await database.updateFitnessFileActivityData(earlier!.id, {
      hasMapData: true,
      mapImagePath: 'medias/2026-07-26/wahoo-map-retry.webp',
      mapImageEmailPath: 'medias/2026-07-26/wahoo-map-retry.jpg'
    })

    const publishMock = getQueue().publish as jest.Mock
    publishMock.mockClear()
    publishMock.mockRejectedValueOnce(new Error('process queue unavailable'))

    await importWithActivity(promoted!.id, 'wahoo-map-retry-promote', {
      overlapFitnessFileIds: [earlier!.id],
      replacePrimaryFileId: earlier!.id
    })

    const afterFailedPublish = await database.getFitnessFile({
      id: promoted!.id
    })
    expect(afterFailedPublish?.statusId).toBe(existing?.statusId)
    expect(afterFailedPublish?.isPrimary).toBe(true)
    expect(afterFailedPublish?.mapImagePath).toBe(
      'medias/2026-07-26/wahoo-map-retry.webp'
    )
    expect(afterFailedPublish?.mapImageEmailPath).toBe(
      'medias/2026-07-26/wahoo-map-retry.jpg'
    )

    publishMock.mockResolvedValue(undefined)
    const groups = await importWithActivity(
      promoted!.id,
      'wahoo-map-retry-again',
      { preserveExistingMapOnRetry: true }
    )

    const afterRetry = await database.getFitnessFile({ id: promoted!.id })
    expect(afterRetry?.mapImagePath).toBe(
      'medias/2026-07-26/wahoo-map-retry.webp'
    )
    expect(afterRetry?.mapImageEmailPath).toBe(
      'medias/2026-07-26/wahoo-map-retry.jpg'
    )
    expect(groups[0]?.processJob).toEqual(
      expect.objectContaining({
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: expect.objectContaining({
          fitnessFileId: promoted!.id,
          statusId: existing?.statusId
        })
      })
    )
    expect(publishMock).toHaveBeenCalledTimes(2)
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
})

import { Database } from '@/lib/database/types'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  REGENERATE_FITNESS_MAPS_JOB_NAME
} from '@/lib/jobs/names'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import {
  createMockStravaDatabase,
  mockGetQueue,
  resetStravaImportMocks
} from './importStravaActivityJob.testUtils'

vi.mock('node:dns/promises', async () => ({
  lookup: vi.fn()
}))

vi.mock('@/lib/services/fitness-files', async () => ({
  saveFitnessFile: vi.fn()
}))

vi.mock('@/lib/services/medias/index', async () => ({
  saveMedia: vi.fn()
}))

vi.mock('@/lib/jobs/importFitnessFilesJob', async () => ({
  importFitnessFiles: vi.fn()
}))

vi.mock('@/lib/services/strava/activity', async () => {
  const actual = await vi.importActual('@/lib/services/strava/activity')
  return {
    ...actual,
    buildGpxFromStravaStreams: vi.fn(),
    buildTcxFromStravaStreams: vi.fn(),
    getStravaActivity: vi.fn(),
    getStravaActivityPhotos: vi.fn(),
    getStravaActivityStreams: vi.fn(),
    getValidStravaAccessToken: vi.fn()
  }
})

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/timelines', async () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

const mockSendNotificationAlerts = vi.fn()
vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: (...args: unknown[]) =>
    mockSendNotificationAlerts(...args)
}))

describe('importStravaActivityJob', () => {
  const database = createMockStravaDatabase()

  beforeEach(() => {
    resetStravaImportMocks(database)
  })

  it('queues map regeneration when existing activity has no map', async () => {
    database.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing'
      }
    ] as never)
    database.getFitnessFile.mockReset()
    database.getFitnessFile.mockResolvedValueOnce({
      id: 'existing-file',
      actorId: 'actor-1',
      statusId: 'status-existing',
      hasMapData: false
    } as never)
    database.getStatus.mockResolvedValueOnce({
      id: 'status-existing',
      type: 'Note',
      text: 'Already imported'
    } as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-regen-map',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    const expectedChildId = getHashFromString(
      'status-existing:existing-file:job-regen-map:regenerate-map'
    )
    expect(mockGetQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: REGENERATE_FITNESS_MAPS_JOB_NAME,
        id: expectedChildId,
        data: {
          actorId: 'actor-1',
          fitnessFileIds: ['existing-file']
        }
      })
    )
  })

  it('derives map regeneration fallback child ID from message.id (identical on redelivery, distinct across generations)', async () => {
    const arrangeReimportWithoutMap = () => {
      database.getFitnessFilesByBatchId.mockResolvedValue([
        {
          id: 'existing-file',
          actorId: 'actor-1',
          statusId: 'status-existing'
        }
      ] as never)
      database.getFitnessFile.mockReset()
      database.getFitnessFile.mockResolvedValue({
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing',
        hasMapData: false
      } as never)
      database.getStatus.mockResolvedValue({
        id: 'status-existing',
        type: 'Note',
        text: 'Already imported'
      } as never)
    }

    // Generation 1 execution
    arrangeReimportWithoutMap()
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-regen-gen1',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    const gen1Calls = (mockGetQueue().publish as jest.Mock).mock.calls
    const gen1Job = gen1Calls[gen1Calls.length - 1][0]
    const expectedGen1Id = getHashFromString(
      'status-existing:existing-file:job-regen-gen1:regenerate-map'
    )
    expect(gen1Job.id).toBe(expectedGen1Id)

    // Parent redelivery of Generation 1: identical parent message.id produces identical child ID
    arrangeReimportWithoutMap()
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-regen-gen1',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    const redeliveryCalls = (mockGetQueue().publish as jest.Mock).mock.calls
    const redeliveryJob = redeliveryCalls[redeliveryCalls.length - 1][0]
    expect(redeliveryJob.id).toBe(expectedGen1Id)

    // Generation 2 execution: different parent message.id produces different child ID
    arrangeReimportWithoutMap()
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-regen-gen2',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    const gen2Calls = (mockGetQueue().publish as jest.Mock).mock.calls
    const gen2Job = gen2Calls[gen2Calls.length - 1][0]
    const expectedGen2Id = getHashFromString(
      'status-existing:existing-file:job-regen-gen2:regenerate-map'
    )
    expect(gen2Job.id).toBe(expectedGen2Id)
    expect(gen2Job.id).not.toBe(expectedGen1Id)
  })

  it('does not queue map regeneration on a fresh import (processing handles the primary map)', async () => {
    // On a brand-new import the primary file is handed to processFitnessFileJob
    // (inside importFitnessFilesJob), which generates the single route map.
    // Publishing a regenerate-map job here too would race that job and, for a
    // file merged in as non-primary, attach a second map — the duplicate-image
    // bug. The fallback must stay quiet on fresh imports.
    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-fresh-no-regen',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(mockGetQueue().publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: REGENERATE_FITNESS_MAPS_JOB_NAME })
    )
  })

  it('does not queue map regeneration for a merged non-primary file on re-import', async () => {
    // A re-import whose file ended up non-primary (merged into a sibling's
    // post) must not regenerate its own map.
    database.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing'
      }
    ] as never)
    database.getFitnessFile.mockReset()
    database.getFitnessFile.mockResolvedValue({
      id: 'existing-file',
      actorId: 'actor-1',
      statusId: 'status-existing',
      isPrimary: false,
      hasMapData: false
    } as never)
    database.getStatus.mockResolvedValueOnce({
      id: 'status-existing',
      type: 'Note',
      text: 'Already imported'
    } as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-reimport-non-primary',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(mockGetQueue().publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: REGENERATE_FITNESS_MAPS_JOB_NAME })
    )
  })

  it('skips map regeneration when existing activity already has a map', async () => {
    database.getFitnessFilesByBatchId.mockResolvedValueOnce([
      {
        id: 'existing-file',
        actorId: 'actor-1',
        statusId: 'status-existing'
      }
    ] as never)
    database.getFitnessFile.mockReset()
    database.getFitnessFile.mockResolvedValue({
      id: 'existing-file',
      actorId: 'actor-1',
      statusId: 'status-existing',
      hasMapData: true
    } as never)
    database.getStatus.mockResolvedValueOnce({
      id: 'status-existing',
      type: 'Note',
      text: 'Already imported'
    } as never)

    await importStravaActivityJob(database as unknown as Database, {
      id: 'job-skip-regen-map',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: 'actor-1',
        stravaActivityId: '123'
      }
    })

    expect(mockGetQueue().publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: REGENERATE_FITNESS_MAPS_JOB_NAME })
    )
  })
})

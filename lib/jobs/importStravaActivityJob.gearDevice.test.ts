import { Database } from '@/lib/database/types'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import { IMPORT_STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'

import {
  createMockStravaDatabase,
  mockGetStravaActivity,
  mockImportFitnessFiles,
  mockSaveFitnessFile,
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

  describe('gear attribution', () => {
    // Strava's own `gear_id` is deliberately not read. Attribution comes from
    // the athlete's shed instead, applied by `processFitnessFileJob` from the
    // gear whose `defaultSports` claims the parsed sport — the mapping the
    // Strava settings page edits. Importing Strava's value used to create a
    // local gear row per Strava id, with a `kind` guessed from an undocumented
    // id prefix and immutable once wrong.
    const rideWithGear = {
      id: 123,
      name: 'Morning Ride',
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Ride',
      visibility: 'everyone',
      gear_id: 'b1234567'
    }

    it('never creates gear from the activity gear id', async () => {
      mockGetStravaActivity.mockResolvedValue(rideWithGear as never)

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-gear-new',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '123' }
      })

      expect(database.createFitnessGear).not.toHaveBeenCalled()
      expect(database.assignFitnessFileGearIfUnset).not.toHaveBeenCalled()
      // The ride itself still imported.
      expect(mockSaveFitnessFile).toHaveBeenCalled()
    })

    it('never attributes a re-imported file from the activity gear id', async () => {
      mockGetStravaActivity.mockResolvedValue(rideWithGear as never)
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
        statusId: 'status-existing'
      } as never)
      database.getStatus.mockResolvedValueOnce({
        id: 'status-existing',
        type: 'Note',
        text: 'Already imported'
      } as never)

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-gear-backfill',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '123' }
      })

      expect(database.createFitnessGear).not.toHaveBeenCalled()
      expect(database.assignFitnessFileGearIfUnset).not.toHaveBeenCalled()
    })
  })

  describe('recording device', () => {
    // The device is NOT Strava's gear: it is the head unit the activity was
    // recorded on, which Strava reports as `device_name` and which the
    // importer already stores. What is new is that it now resolves to a gear
    // row of its own.
    const rideWithDevice = {
      id: 321,
      name: 'Morning Ride',
      start_date: '2026-01-01T00:00:00.000Z',
      sport_type: 'Ride',
      visibility: 'everyone',
      device_name: 'Wahoo ELEMNT BOLT'
    }

    it('creates the device row and stamps it on a first import', async () => {
      mockGetStravaActivity.mockResolvedValue(rideWithDevice as never)
      database.findFitnessGearByDeviceKey.mockResolvedValue(null)
      database.createFitnessGear.mockResolvedValue({
        id: 'device-1',
        actorId: 'actor-1',
        kind: 'device',
        name: 'Wahoo ELEMNT BOLT',
        defaultSports: [],
        createdAt: 1000,
        updatedAt: 1000
      })

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-device-new',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '321' }
      })

      expect(database.createFitnessGear).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'device',
          deviceKey: 'name:wahoo elemnt bolt'
        })
      )
      expect(database.updateFitnessFileActivityData).toHaveBeenCalledWith(
        'new-file',
        { deviceGearId: 'device-1' }
      )
    })

    it('links a re-imported file from the device fields it already carries', async () => {
      // The re-import path backfills nothing when the device columns are
      // already stored, so the link has to be driven from the merged row —
      // otherwise a file imported before devices had rows never gets one.
      mockGetStravaActivity.mockResolvedValue(rideWithDevice as never)
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
        deviceName: 'Wahoo ELEMNT BOLT',
        deviceManufacturer: 'wahoo_fitness',
        sourceUrl: 'https://www.strava.com/activities/321'
      } as never)
      database.getStatus.mockResolvedValueOnce({
        id: 'status-existing',
        type: 'Note',
        text: 'Already imported'
      } as never)
      database.findFitnessGearByDeviceKey.mockResolvedValue({
        id: 'device-1',
        actorId: 'actor-1',
        kind: 'device',
        name: 'the Bolt',
        defaultSports: [],
        createdAt: 1000,
        updatedAt: 1000
      })

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-device-reimport',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '321' }
      })

      // Found, not recreated — and the owner's rename survives.
      expect(database.createFitnessGear).not.toHaveBeenCalled()
      expect(database.updateFitnessFileActivityData).toHaveBeenCalledWith(
        'existing-file',
        { deviceGearId: 'device-1' }
      )
    })

    it('imports the ride anyway when the device lookup fails', async () => {
      mockGetStravaActivity.mockResolvedValue(rideWithDevice as never)
      database.findFitnessGearByDeviceKey.mockRejectedValue(
        new Error('connection reset')
      )

      await importStravaActivityJob(database as unknown as Database, {
        id: 'job-device-failure',
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: 'actor-1', stravaActivityId: '321' }
      })

      expect(mockSaveFitnessFile).toHaveBeenCalled()
      expect(mockImportFitnessFiles).toHaveBeenCalled()
    })
  })
})

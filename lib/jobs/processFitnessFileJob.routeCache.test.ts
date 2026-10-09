import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { FITNESS_FILE_ROUTE_SOURCE_VERSION } from '@/lib/services/fitness-files/fileRouteCache'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import {
  createProcessFileHelpers,
  defaultActivityData,
  mockGenerateMapImage,
  mockParseFitnessFile,
  resetProcessMocks
} from './processFitnessFileJob.testUtils'

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

vi.mock('@/lib/services/fitness-files/generateMapImage', async () => ({
  generateMapImage: vi.fn()
}))

vi.mock('@/lib/services/medias', async () => ({
  saveMedia: vi.fn(),
  saveMediaImageRendition: vi.fn(),
  deleteMediaFile: vi.fn()
}))

const mockSendNotificationAlerts = vi.fn()
vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: (...args: unknown[]) =>
    mockSendNotificationAlerts(...args)
}))

vi.mock('@/lib/services/altText/openai', () => ({
  generateRouteAltText: vi.fn()
}))

describe('processFitnessFileJob', () => {
  const database = getTestSQLDatabase()
  let actor: Actor

  const { createStatusWithFitnessFile, setPrivacyZone, clearPrivacyZone } =
    createProcessFileHelpers(database, () => actor)

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
    resetProcessMocks()
  })

  describe('route cache', () => {
    it('caches the parsed route so a heatmap rebuild need not re-read the file', async () => {
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Cached ride'
      })

      await processFitnessFileJob(database, {
        id: 'job-route-cache',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const [route] = await database.getFitnessFileRoutes({
        fitnessFileIds: [fitnessFileId]
      })

      expect(route).toMatchObject({
        fitnessFileId,
        actorId: actor.id,
        points: [
          [37.78, -122.42],
          [37.79, -122.41]
        ],
        pointCount: 2,
        sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION,
        bounds: {
          minLat: 37.78,
          maxLat: 37.79,
          minLng: -122.42,
          maxLng: -122.41
        }
      })
    })

    it('caches the route before privacy trimming, so moving a zone needs no re-read', async () => {
      // The zone swallows the route's first point. The cached row must still
      // carry it: privacy is applied when the heatmap is built, from whatever
      // the settings say then, and a pre-trimmed cache could never grow the
      // end back without re-downloading the file.
      const settingsId = await setPrivacyZone({
        privacyHomeLatitude: 37.78,
        privacyHomeLongitude: -122.42,
        privacyHideRadiusMeters: 500
      })

      try {
        const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
          text: 'Ride from home'
        })

        await processFitnessFileJob(database, {
          id: 'job-route-cache-privacy',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: { actorId: actor.id, statusId, fitnessFileId }
        })

        // The zone was genuinely in force: it swallows the first of the two
        // points, leaving one visible, and a single point is not a route — so
        // no map is drawn. Without this the test asserts the same literal as
        // the zone-less test above it and would keep passing if the zone
        // silently stopped applying.
        expect(mockGenerateMapImage).not.toHaveBeenCalled()
        const processed = await database.getFitnessFile({ id: fitnessFileId })
        expect(processed?.hasMapData).toBe(false)

        const [route] = await database.getFitnessFileRoutes({
          fitnessFileIds: [fitnessFileId]
        })

        expect(route?.points).toEqual([
          [37.78, -122.42],
          [37.79, -122.41]
        ])
      } finally {
        await clearPrivacyZone(settingsId)
      }
    })

    it('writes an empty row for an activity with no GPS, as a negative cache', async () => {
      mockParseFitnessFile.mockResolvedValue({
        ...defaultActivityData,
        coordinates: [],
        trackPoints: []
      })

      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Treadmill run'
      })

      await processFitnessFileJob(database, {
        id: 'job-route-cache-no-gps',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const [route] = await database.getFitnessFileRoutes({
        fitnessFileIds: [fitnessFileId]
      })

      expect(route).toMatchObject({
        fitnessFileId,
        points: [],
        pointCount: 0
      })
      expect(route?.bounds).toBeUndefined()
    })

    it('completes the activity even when the route cannot be cached', async () => {
      // A cache of a cache: a failed write is invisible to the owner, because
      // the rebuild just parses the file as it does today. It must never take
      // down an activity that parsed and posted fine.
      const upsertError = new Error('route cache write failed')
      const upsertSpy = vi
        .spyOn(database, 'upsertFitnessFileRoute')
        .mockRejectedValueOnce(upsertError)
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

      try {
        const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
          text: 'Ride that outlives a cache failure'
        })

        await processFitnessFileJob(database, {
          id: 'job-route-cache-failure',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: { actorId: actor.id, statusId, fitnessFileId }
        })

        const updatedFitnessFile = await database.getFitnessFile({
          id: fitnessFileId
        })
        expect(updatedFitnessFile).toMatchObject({
          processingStatus: 'completed',
          totalDistanceMeters: 5_200
        })

        expect(warnSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Failed to cache the fitness file route',
            fitnessFileId
          })
        )

        const routes = await database.getFitnessFileRoutes({
          fitnessFileIds: [fitnessFileId]
        })
        expect(routes).toHaveLength(0)
      } finally {
        upsertSpy.mockRestore()
        warnSpy.mockRestore()
      }
    })
  })
})

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import { IMPORT_STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import {
  getFitnessFileBuffer,
  saveFitnessFile
} from '@/lib/services/fitness-files'
import { generateMapImage } from '@/lib/services/fitness-files/generateMapImage'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { saveMedia } from '@/lib/services/medias'
import {
  buildGpxFromStravaStreams,
  buildTcxFromStravaStreams,
  getStravaActivity,
  getStravaActivityPhotos,
  getStravaActivityStreams,
  getValidStravaAccessToken
} from '@/lib/services/strava/activity'
import { getStravaActivityBatchId } from '@/lib/services/strava/activityBatch'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { StatusNote } from '@/lib/types/domain/status'

// Run published jobs (e.g. PROCESS_FITNESS_FILE_JOB) inline against the SAME
// in-memory test database, so the full import -> process -> map-attachment path
// executes end-to-end. (The real NoQueue resolves its own getDatabase(), which
// would be a different instance than this test's.)
const hoisted = vi.hoisted(() => ({ database: null as unknown }))
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    publish: async (message: { name: string }) => {
      const { JOBS } = await import('@/lib/jobs')
      const job = (JOBS as Record<string, unknown>)[message.name] as
        ((db: unknown, msg: unknown) => Promise<void>) | undefined
      if (job && hoisted.database) {
        await job(hoisted.database, message)
      }
    }
  })
}))

vi.mock('@/lib/services/fitness-files', async () => {
  const actual = await vi.importActual('@/lib/services/fitness-files')
  return {
    ...actual,
    saveFitnessFile: vi.fn(),
    getFitnessFileBuffer: vi.fn()
  }
})

vi.mock('@/lib/services/fitness-files/parseFitnessFile', async () => {
  const actual = await vi.importActual(
    '@/lib/services/fitness-files/parseFitnessFile'
  )
  return { ...actual, parseFitnessFile: vi.fn() }
})

vi.mock('@/lib/services/fitness-files/generateMapImage', () => ({
  generateMapImage: vi.fn()
}))

vi.mock('@/lib/services/medias', async () => {
  const actual = await vi.importActual('@/lib/services/medias')
  return { ...actual, saveMedia: vi.fn() }
})

vi.mock('@/lib/services/strava/activity', async () => {
  const actual = await vi.importActual('@/lib/services/strava/activity')
  return {
    ...actual,
    getStravaActivity: vi.fn(),
    getStravaActivityStreams: vi.fn(),
    getStravaActivityPhotos: vi.fn(),
    getValidStravaAccessToken: vi.fn(),
    buildTcxFromStravaStreams: vi.fn(),
    buildGpxFromStravaStreams: vi.fn()
  }
})

const mockSaveFitnessFile = saveFitnessFile as jest.MockedFunction<
  typeof saveFitnessFile
>
const mockGetFitnessFileBuffer = getFitnessFileBuffer as jest.MockedFunction<
  typeof getFitnessFileBuffer
>
const mockParseFitnessFile = parseFitnessFile as jest.MockedFunction<
  typeof parseFitnessFile
>
const mockGenerateMapImage = generateMapImage as jest.MockedFunction<
  typeof generateMapImage
>
const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>
const mockGetStravaActivity = getStravaActivity as jest.MockedFunction<
  typeof getStravaActivity
>
const mockGetStravaActivityStreams =
  getStravaActivityStreams as jest.MockedFunction<
    typeof getStravaActivityStreams
  >
const mockGetStravaActivityPhotos =
  getStravaActivityPhotos as jest.MockedFunction<typeof getStravaActivityPhotos>
const mockGetValidStravaAccessToken =
  getValidStravaAccessToken as jest.MockedFunction<
    typeof getValidStravaAccessToken
  >
const mockBuildTcx = buildTcxFromStravaStreams as jest.MockedFunction<
  typeof buildTcxFromStravaStreams
>
const mockBuildGpx = buildGpxFromStravaStreams as jest.MockedFunction<
  typeof buildGpxFromStravaStreams
>

// Same ride recorded on two devices => two Strava activities at the same start.
const RIDE_START = '2026-03-01T08:00:00.000Z'

describe('importStravaActivityJob same-ride merge', () => {
  const { database, prepare } = createTestDatabase()
  let actor: Actor

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    hoisted.database = database
    await database.createFitnessSettings({
      actorId: actor.id,
      serviceType: 'strava',
      accessToken: 'access-token'
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()

    mockGetValidStravaAccessToken.mockResolvedValue('access-token')
    mockGetStravaActivityStreams.mockResolvedValue({
      latlng: {
        type: 'latlng',
        data: [
          [37.77, -122.41],
          [37.78, -122.42]
        ]
      },
      time: { type: 'time', data: [0, 3600] }
    })
    mockBuildTcx.mockReturnValue(null)
    mockBuildGpx.mockReturnValue('<?xml version="1.0"?><gpx>...</gpx>')
    mockGetStravaActivityPhotos.mockResolvedValue([])

    // saveFitnessFile persists a real row so the importer/processor can read it.
    mockSaveFitnessFile.mockImplementation(async (db, fileActor, options) => {
      const created = await db.createFitnessFile({
        actorId: fileActor.id,
        path: `fitness/${options.file.name}`,
        fileName: options.file.name,
        fileType: 'gpx',
        mimeType: 'application/gpx+xml',
        bytes: 64,
        importBatchId: options.importBatchId,
        sourceUrl: options.sourceUrl
      })
      return {
        id: created!.id,
        type: 'fitness',
        file_type: 'gpx',
        mime_type: 'application/gpx+xml',
        url: `http://llun.test/api/v1/fitness-files/${created!.id}`,
        fileName: options.file.name,
        size: 64
      } as never
    })

    mockGetFitnessFileBuffer.mockResolvedValue(Buffer.from('gpx-bytes'))

    // Same ride => identical parsed start time + duration => overlap merge.
    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 37.77, lng: -122.41 },
        { lat: 37.78, lng: -122.42 }
      ],
      trackPoints: [
        { lat: 37.77, lng: -122.41 },
        { lat: 37.78, lng: -122.42 }
      ],
      totalDistanceMeters: 20_000,
      totalDurationSeconds: 3_600,
      elevationGainMeters: 50,
      activityType: 'cycling',
      startTime: new Date(RIDE_START)
    } as never)

    mockGenerateMapImage.mockResolvedValue(Buffer.from('map-image'))
    // Numeric ids: attachments.mediaId is an integer column on PostgreSQL.
    let mediaCounter = 0
    mockSaveMedia.mockImplementation(async () => {
      mediaCounter += 1
      return {
        id: String(9200 + mediaCounter),
        type: 'image',
        mime_type: 'image/webp',
        url: `https://llun.test/api/v1/files/medias/route-map-${mediaCounter}.webp`,
        preview_url: null,
        text_url: null,
        remote_url: null,
        meta: { original: { width: 800, height: 600 } },
        description: 'Route map'
      } as never
    })
  })

  const importActivity = async (stravaActivityId: string) => {
    mockGetStravaActivity.mockResolvedValueOnce({
      id: Number(stravaActivityId),
      name: 'Morning Ride',
      distance: 20_000,
      elapsed_time: 3_600,
      total_elevation_gain: 50,
      start_date: RIDE_START,
      sport_type: 'Ride',
      visibility: 'everyone'
    } as never)

    await importStravaActivityJob(database, {
      id: `job-${stravaActivityId}`,
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: { actorId: actor.id, stravaActivityId }
    })
  }

  it('collapses two same-ride imports into one post with a single route map', async () => {
    // The two webhooks arrive one after another (real concurrency is serialized
    // by the per-actor lock to exactly this order).
    await importActivity('1001')
    await importActivity('1002')

    const [fileA] = await database.getFitnessFilesByBatchId({
      batchId: getStravaActivityBatchId('1001')
    })
    const [fileB] = await database.getFitnessFilesByBatchId({
      batchId: getStravaActivityBatchId('1002')
    })

    // Both files were assigned to the SAME post (no duplicate).
    expect(fileA.statusId).toBeTruthy()
    expect(fileB.statusId).toBe(fileA.statusId)

    // Exactly one of the two is primary.
    expect([fileA.isPrimary, fileB.isPrimary].filter(Boolean)).toHaveLength(1)

    // The merged post shows a single route map, not one per device.
    const status = (await database.getStatus({
      statusId: fileA.statusId as string,
      withReplies: false
    })) as StatusNote
    const mapAttachments = status?.attachments.filter(
      (attachment) => attachment.name === 'Activity route map'
    )
    expect(mapAttachments).toHaveLength(1)
  })

  describe('an indoor evening of two Rouvy rides and one trainer recording', () => {
    // 2026-10-30, CET (UTC+1). Both Rouvy rides carry virtual GPS; the trainer
    // recording (Wahoo/Garmin, `trainer: true`) has none and covers both.
    const rides = {
      pukaki: {
        name: 'ROUVY - Lake Pukaki',
        sport_type: 'VirtualRide',
        startOffsetSeconds: 6 * 60 + 10,
        elapsed_time: 161,
        hasRoute: true
      },
      slovenia: {
        name: 'ROUVY - Tour of Slovenia',
        sport_type: 'VirtualRide',
        startOffsetSeconds: 10 * 60 + 57,
        elapsed_time: 5_428,
        hasRoute: true
      },
      indoor: {
        name: 'Indoor Cycling',
        sport_type: 'Ride',
        startOffsetSeconds: 0,
        elapsed_time: 6_154,
        hasRoute: false
      }
    }
    type RideKey = keyof typeof rides
    // Parse results by Strava activity id, matched from the stored file name.
    const parsedActivities = new Map<string, unknown>()

    const importRide = async (
      stravaActivityId: string,
      key: RideKey,
      indoorStartIso: string
    ) => {
      const ride = rides[key]
      const startDate = new Date(
        Date.parse(indoorStartIso) + ride.startOffsetSeconds * 1000
      ).toISOString()
      parsedActivities.set(stravaActivityId, {
        coordinates: ride.hasRoute
          ? [
              { lat: 46.05, lng: 14.5 },
              { lat: 46.06, lng: 14.51 }
            ]
          : [],
        trackPoints: [],
        totalDistanceMeters: 10_000,
        totalDurationSeconds: ride.elapsed_time,
        activityType:
          ride.sport_type === 'VirtualRide' ? 'virtual_ride' : 'ride',
        startTime: new Date(startDate)
      })
      mockGetStravaActivity.mockResolvedValueOnce({
        id: Number(stravaActivityId),
        name: ride.name,
        distance: 10_000,
        elapsed_time: ride.elapsed_time,
        moving_time: ride.elapsed_time,
        start_date: startDate,
        sport_type: ride.sport_type,
        trainer: !ride.hasRoute,
        visibility: 'everyone'
      } as never)

      await importStravaActivityJob(database, {
        id: `job-${stravaActivityId}`,
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId: actor.id, stravaActivityId }
      })

      const [file] = await database.getFitnessFilesByBatchId({
        batchId: getStravaActivityBatchId(stravaActivityId)
      })
      return file
    }

    beforeEach(() => {
      parsedActivities.clear()
      mockGetFitnessFileBuffer.mockImplementation(async (_db, fitnessFileId) =>
        Buffer.from(
          (await database.getFitnessFile({ id: fitnessFileId }))?.fileName ?? ''
        )
      )
      mockParseFitnessFile.mockImplementation(async ({ buffer }) => {
        const stravaActivityId = /strava-(\d+)\./.exec(buffer.toString())?.[1]
        const parsed = stravaActivityId
          ? parsedActivities.get(stravaActivityId)
          : undefined
        if (!parsed) throw new Error(`No parse fixture for ${buffer}`)
        return parsed as never
      })
    })

    it('attaches the trainer recording imported last to the main ride, not the warm-up', async () => {
      const indoorStart = '2026-10-30T17:09:09.000Z'
      const pukaki = await importRide('3001', 'pukaki', indoorStart)
      const slovenia = await importRide('3002', 'slovenia', indoorStart)
      const indoor = await importRide('3003', 'indoor', indoorStart)

      expect(pukaki.statusId).toBeTruthy()
      expect(slovenia.statusId).toBeTruthy()
      expect(slovenia.statusId).not.toBe(pukaki.statusId)
      expect(indoor.statusId).toBe(slovenia.statusId)
      expect(indoor.isPrimary).toBe(false)
      expect(
        await database.getFitnessFilesByStatus({
          statusId: pukaki.statusId as string
        })
      ).toHaveLength(1)
    })

    it('collects both Rouvy rides on the trainer post when the trainer recording arrives first', async () => {
      const indoorStart = '2026-10-23T16:09:09.000Z'
      const indoor = await importRide('3101', 'indoor', indoorStart)
      const pukaki = await importRide('3102', 'pukaki', indoorStart)
      const slovenia = await importRide('3103', 'slovenia', indoorStart)

      expect(indoor.statusId).toBeTruthy()
      expect(pukaki.statusId).toBe(indoor.statusId)
      expect(slovenia.statusId).toBe(indoor.statusId)
      // The Strava importer never promotes a richer file, so the first
      // recording stays the post's primary.
      expect(
        (await database.getFitnessFile({ id: indoor.id }))?.isPrimary
      ).toBe(true)
    })
  })
})

import { getTestSQLDatabase } from '@/lib/database/testUtils'
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
  const database = getTestSQLDatabase()
  let actor: Actor

  beforeAll(async () => {
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
    let mediaCounter = 0
    mockSaveMedia.mockImplementation(async () => {
      mediaCounter += 1
      return {
        id: `map-media-${mediaCounter}`,
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
    const status = await database.getStatus({
      statusId: fileA.statusId as string,
      withReplies: false
    })
    const mapAttachments = status?.attachments.filter(
      (attachment) => attachment.name === 'Activity route map'
    )
    expect(mapAttachments).toHaveLength(1)
  })
})

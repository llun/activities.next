import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
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

// Runs published jobs inline against the SAME in-memory test database, so the
// whole import -> process -> federate path executes end-to-end, and records
// what the status looked like AT THE MOMENT the Create was queued. That last
// part is the point of this file: publishing the process job is what federates,
// and under NoQueue it runs inline, so a status still missing its caption or
// map when SEND_NOTE is queued is exactly the bug this guards.
//
// SEND_NOTE itself is captured rather than dispatched — delivery is
// sendNoteJob's own concern and needs no network here.
const hoisted = vi.hoisted(() => ({
  database: null as unknown,
  sendNoteSnapshots: [] as {
    statusId: string
    text: string
    attachmentNames: string[]
  }[]
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    publish: async (message: {
      name: string
      data?: { statusId?: string }
    }) => {
      const database = hoisted.database as Database | null
      if (!database) return

      if (message.name === SEND_NOTE_JOB_NAME) {
        const statusId = message.data?.statusId as string
        const status = await database.getStatus({
          statusId,
          withReplies: false
        })
        hoisted.sendNoteSnapshots.push({
          statusId,
          text: status && 'text' in status ? status.text : '',
          attachmentNames:
            status && 'attachments' in status
              ? status.attachments.map((attachment) => attachment.name ?? '')
              : []
        })
        return
      }

      const { JOBS } = await import('@/lib/jobs')
      const job = (JOBS as Record<string, unknown>)[message.name] as
        ((db: unknown, msg: unknown) => Promise<void>) | undefined
      if (job) {
        await job(database, message)
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

// Every test in this file shares one in-memory database, and the importer
// merges activities that overlap in time — so each test needs its own start or
// its ride would join the previous test's post and be treated as a re-import.
const rideStart = (dayOfMonth: number) =>
  `2026-04-${String(dayOfMonth).padStart(2, '0')}T08:00:00.000Z`
const ACTIVITY_NAME = 'Morning Ride'

describe('importStravaActivityJob federation', () => {
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
    hoisted.sendNoteSnapshots = []

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
      activityType: 'cycling'
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

  const importActivity = async (
    stravaActivityId: string,
    startDay: number,
    data: Record<string, unknown> = {}
  ) => {
    const startDate = rideStart(startDay)
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
      startTime: new Date(startDate)
    } as never)
    mockGetStravaActivity.mockResolvedValueOnce({
      id: Number(stravaActivityId),
      name: ACTIVITY_NAME,
      distance: 20_000,
      elapsed_time: 3_600,
      total_elevation_gain: 50,
      start_date: startDate,
      sport_type: 'Ride',
      visibility: 'everyone'
    } as never)

    await importStravaActivityJob(database, {
      id: `job-${stravaActivityId}`,
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: { actorId: actor.id, stravaActivityId, ...data }
    })
  }

  it('federates a webhook import once its caption and route map are on the status', async () => {
    await importActivity('2001', 1, { publishSendNote: true })

    expect(hoisted.sendNoteSnapshots).toHaveLength(1)
    const [snapshot] = hoisted.sendNoteSnapshots
    // Both were written before the Create was queued. Federating first would
    // deliver an empty note that no later job re-sends.
    expect(snapshot.text).toContain(ACTIVITY_NAME)
    expect(snapshot.attachmentNames).toContain('Activity route map')
  })

  it('does not federate an import that did not opt in', async () => {
    await importActivity('2002', 2)

    // Proves the pipeline actually ran for THIS ride. Without it the test
    // passes for the wrong reason the moment its start day collides with
    // another test's: the ride merges into that status, no process job is
    // published at all, and "no Create" becomes vacuously true.
    expect(mockGenerateMapImage).toHaveBeenCalled()
    expect(hoisted.sendNoteSnapshots).toHaveLength(0)
  })

  it('does not federate again when the same activity is imported a second time', async () => {
    await importActivity('2003', 3, { publishSendNote: true })
    expect(hoisted.sendNoteSnapshots).toHaveLength(1)

    hoisted.sendNoteSnapshots = []
    await importActivity('2003', 3, { publishSendNote: true })

    expect(hoisted.sendNoteSnapshots).toHaveLength(0)
  })

  it('federates one Create for a ride merged from two device webhooks', async () => {
    // A single ride recorded on two devices arrives as two Strava activities.
    // They collapse into one post, so exactly one Create describes the ride.
    await importActivity('2004', 4, { publishSendNote: true })
    await importActivity('2005', 4, { publishSendNote: true })

    const [fileA] = await database.getFitnessFilesByBatchId({
      batchId: getStravaActivityBatchId('2004')
    })
    const [fileB] = await database.getFitnessFilesByBatchId({
      batchId: getStravaActivityBatchId('2005')
    })
    expect(fileB.statusId).toBe(fileA.statusId)

    expect(hoisted.sendNoteSnapshots).toHaveLength(1)
    expect(hoisted.sendNoteSnapshots[0].statusId).toBe(fileA.statusId)
  })

  it('federates a webhook import even when Strava activity has visibility: only_me', async () => {
    const startDate = rideStart(6)
    mockParseFitnessFile.mockResolvedValueOnce({
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
      startTime: new Date(startDate)
    } as never)
    mockGetStravaActivity.mockResolvedValueOnce({
      id: 2006,
      name: ACTIVITY_NAME,
      distance: 20_000,
      elapsed_time: 3_600,
      total_elevation_gain: 50,
      start_date: startDate,
      sport_type: 'Ride',
      visibility: 'only_me'
    } as never)

    await importStravaActivityJob(database, {
      id: 'job-2006',
      name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
      data: {
        actorId: actor.id,
        stravaActivityId: '2006',
        publishSendNote: true
      }
    })

    expect(hoisted.sendNoteSnapshots).toHaveLength(1)
    expect(hoisted.sendNoteSnapshots[0].text).toContain(ACTIVITY_NAME)
  })
})

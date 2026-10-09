import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { getQueue } from '@/lib/services/queue'
import type { Queue } from '@/lib/services/queue/type'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import {
  createProcessFileHelpers,
  defaultActivityData,
  mockGenerateMapImage,
  mockParseFitnessFile,
  mockSaveMedia,
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

  it('processes fitness file, generates map, updates note text, and queues send job', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: ''
    })

    await database.createAttachment({
      actorId: actor.id,
      statusId,
      mediaType: 'image/png',
      url: 'https://llun.test/api/v1/files/medias/original-photo.png',
      width: 1024,
      height: 768,
      name: 'Original photo'
    })

    await processFitnessFileJob(database, {
      id: 'job-id-1',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const updatedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(updatedFitnessFile).toMatchObject({
      processingStatus: 'completed',
      totalDistanceMeters: 5_200,
      totalDurationSeconds: 1_695,
      elevationGainMeters: 130,
      activityType: 'running',
      hasMapData: true,
      mapImagePath: 'medias/route-map.webp',
      avgPower: 210,
      maxPower: 450,
      avgHeartRate: 145,
      maxHeartRate: 172,
      totalWorkKj: 350,
      elevationSeries: [10, 20, 30]
    })

    const status = await database.getStatus({ statusId, withReplies: false })
    expect(status?.type).toBe(StatusType.enum.Note)
    if (status?.type !== StatusType.enum.Note) {
      fail('Expected a note status')
    }

    expect(status.text).toContain('Running')
    expect(status.text).toContain('5.2')
    expect(status.attachments).toHaveLength(2)
    expect(status.attachments[0]).toMatchObject({
      name: 'Activity route map',
      url: 'https://llun.test/api/v1/files/medias/route-map.webp'
    })

    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(`${statusId}:send-note`),
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId
      }
    })

    const publishCalls = (
      getQueue().publish as jest.MockedFunction<Queue['publish']>
    ).mock.calls
    const heatmapCalls = publishCalls.filter(
      ([msg]) => msg.name === GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME
    )
    // Import must not trigger heatmap regeneration — that is decoupled to the
    // explicit generate route so the memory-heavy aggregation never runs on the
    // import / Strava-webhook path.
    expect(heatmapCalls).toHaveLength(0)
  })

  it('completes without map generation when there are no GPS coordinates', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Indoor workout summary'
    })

    mockParseFitnessFile.mockResolvedValue({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 0,
      totalDurationSeconds: 2_400,
      activityType: 'strength'
    })

    await processFitnessFileJob(database, {
      id: 'job-id-2',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const updatedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(updatedFitnessFile).toMatchObject({
      processingStatus: 'completed',
      totalDistanceMeters: 0,
      totalDurationSeconds: 2_400,
      hasMapData: false
    })

    expect(mockGenerateMapImage).not.toHaveBeenCalled()
    expect(mockSaveMedia).not.toHaveBeenCalled()
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
  })

  it('filters out home-radius points before generating route map images', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Privacy filtered route'
    })

    const settingsId = await setPrivacyZone({
      privacyHomeLatitude: 37.78,
      privacyHomeLongitude: -122.42,
      privacyHideRadiusMeters: 50
    })

    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 37.78, lng: -122.42 },
        { lat: 37.7802, lng: -122.4202 },
        { lat: 37.79, lng: -122.41 },
        { lat: 37.7902, lng: -122.4098 }
      ],
      trackPoints: [
        { lat: 37.78, lng: -122.42 },
        { lat: 37.7802, lng: -122.4202 },
        { lat: 37.79, lng: -122.41 },
        { lat: 37.7902, lng: -122.4098 }
      ],
      totalDistanceMeters: 5_200,
      totalDurationSeconds: 1_695,
      elevationGainMeters: 130,
      activityType: 'running'
    })

    try {
      await processFitnessFileJob(database, {
        id: 'job-id-privacy-filter',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })
    } finally {
      await clearPrivacyZone(settingsId)
    }

    expect(mockGenerateMapImage).toHaveBeenCalledWith({
      coordinates: [
        { lat: 37.79, lng: -122.41 },
        { lat: 37.7902, lng: -122.4098 }
      ],
      routeSegments: [
        [
          { lat: 37.79, lng: -122.41 },
          { lat: 37.7902, lng: -122.4098 }
        ]
      ]
    })
  })

  it('draws one unbroken route when the activity re-enters a privacy zone', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Loop back past home'
    })

    const settingsId = await setPrivacyZone({
      privacyHomeLatitude: 37.78,
      privacyHomeLongitude: -122.42,
      privacyHideRadiusMeters: 50
    })

    // Starts on the zone centre, runs ~1.4km out, comes back THROUGH the centre
    // at index 3, then runs out again and finishes clear of the zone.
    const coordinates = [
      { lat: 37.78, lng: -122.42 },
      { lat: 37.7802, lng: -122.4202 },
      { lat: 37.79, lng: -122.41 },
      { lat: 37.78, lng: -122.42 },
      { lat: 37.79, lng: -122.41 },
      { lat: 37.8, lng: -122.4 }
    ]

    mockParseFitnessFile.mockResolvedValue({
      coordinates,
      trackPoints: coordinates,
      totalDistanceMeters: 6_000,
      totalDurationSeconds: 1_800,
      elevationGainMeters: 90,
      activityType: 'running'
    })

    try {
      await processFitnessFileJob(database, {
        id: 'job-id-privacy-reentry',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })
    } finally {
      await clearPrivacyZone(settingsId)
    }

    // A single `routeSegments` entry, so the renderer draws one LineString. The
    // head is trimmed; the mid-route pass through the centre is kept rather than
    // punching a hole that would localise it.
    const visibleRoute = [
      { lat: 37.79, lng: -122.41 },
      { lat: 37.78, lng: -122.42 },
      { lat: 37.79, lng: -122.41 },
      { lat: 37.8, lng: -122.4 }
    ]
    expect(mockGenerateMapImage).toHaveBeenCalledWith({
      coordinates: visibleRoute,
      routeSegments: [visibleRoute]
    })
  })

  it('marks processing as failed and skips federation when parsing fails', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Will fail'
    })

    mockParseFitnessFile.mockRejectedValue(new Error('parse failure'))

    await processFitnessFileJob(database, {
      id: 'job-id-4',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const updatedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(updatedFitnessFile?.processingStatus).toBe('failed')
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('records the failure reason on the fitness file when processing fails', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Will fail'
    })

    mockParseFitnessFile.mockRejectedValue(
      new Error('Invalid TCX file structure')
    )

    await processFitnessFileJob(database, {
      id: 'job-id-failure-reason',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const failedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(failedFitnessFile?.importError).toBe('Invalid TCX file structure')
  })

  it('records a reason even when the thrown value is not an Error', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Will reject with a non-Error'
    })

    // A thrown string/SDK object has no `.message`; without a guard the reason
    // is written as undefined, leaving the row `failed` with no explanation (or
    // a stale one from an earlier failure).
    mockParseFitnessFile.mockRejectedValue('socket hang up')

    await processFitnessFileJob(database, {
      id: 'job-id-non-error',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const failedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(failedFitnessFile?.processingStatus).toBe('failed')
    expect(failedFitnessFile?.importError).toBe('socket hang up')
  })

  it('clears a previous failure reason when processing succeeds on retry', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Will fail then succeed'
    })

    mockParseFitnessFile.mockRejectedValue(new Error('transient storage error'))
    await processFitnessFileJob(database, {
      id: 'job-id-retry-failure',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })
    expect(
      (await database.getFitnessFile({ id: fitnessFileId }))?.importError
    ).toBe('transient storage error')

    mockParseFitnessFile.mockResolvedValue(defaultActivityData)
    await processFitnessFileJob(database, {
      id: 'job-id-retry-success',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: { actorId: actor.id, statusId, fitnessFileId }
    })

    const retriedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(retriedFitnessFile?.processingStatus).toBe('completed')
    expect(retriedFitnessFile?.importError).toBeUndefined()
  })

  it('keeps the activity completed when the federation publish fails', async () => {
    // The publish sits after processingStatus 'completed' is persisted, so an
    // uncontained queue failure rewrote a fully processed ride to 'failed' —
    // hiding it from the detail dashboard, the stat grid and every rollup
    // because its Create could not be queued.
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: ''
    })
    ;(getQueue().publish as jest.Mock).mockImplementation(
      async (message: { name: string }) => {
        if (message.name === SEND_NOTE_JOB_NAME) {
          throw new Error('queue exploded')
        }
      }
    )

    await expect(
      processFitnessFileJob(database, {
        id: 'job-id-send-note-publish-failure',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId,
          fitnessFileId,
          publishSendNote: true
        }
      })
    ).resolves.toBeUndefined()

    const updatedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(updatedFitnessFile?.processingStatus).toBe('completed')
  })

  it('skips federation publish when publishSendNote is false', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: ''
    })

    await processFitnessFileJob(database, {
      id: 'job-id-5',
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId,
        fitnessFileId,
        publishSendNote: false
      }
    })

    const updatedFitnessFile = await database.getFitnessFile({
      id: fitnessFileId
    })
    expect(updatedFitnessFile?.processingStatus).toBe('completed')

    const publishCalls = (
      getQueue().publish as jest.MockedFunction<Queue['publish']>
    ).mock.calls
    const sendNoteCalls = publishCalls.filter(
      ([msg]) => msg.name === SEND_NOTE_JOB_NAME
    )
    expect(sendNoteCalls).toHaveLength(0)

    const heatmapCalls = publishCalls.filter(
      ([msg]) => msg.name === GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME
    )
    expect(heatmapCalls).toHaveLength(0)
  })

  describe('activity caption', () => {
    it('captions from the raw sport, not the coarser key it is stored as', async () => {
      // `Handcycle` is STORED as `ride` — gear attribution asks "which bike".
      // The caption is not asking that, and reading the stored key here made a
      // directly uploaded handcycle ride say "Cycling" while the identical ride
      // imported from Strava said "Handcycling", because that path captions
      // from its own raw `sport_type`.
      mockParseFitnessFile.mockResolvedValue({
        ...defaultActivityData,
        activityType: 'ride',
        rawActivityType: 'Handcycle'
      })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: ''
      })

      await processFitnessFileJob(database, {
        id: 'job-caption-raw-sport',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const status = await database.getStatus({
        statusId,
        withReplies: false
      })
      if (status?.type !== StatusType.enum.Note) fail('Expected a note status')
      expect(status.text).toContain('Handcycling')
      expect(status.text).not.toContain('Cycling —')
    })

    it('falls back to the stored key when no raw sport was parsed', async () => {
      mockParseFitnessFile.mockResolvedValue({
        ...defaultActivityData,
        activityType: 'ride',
        rawActivityType: undefined
      })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: ''
      })

      await processFitnessFileJob(database, {
        id: 'job-caption-key-fallback',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const status = await database.getStatus({
        statusId,
        withReplies: false
      })
      if (status?.type !== StatusType.enum.Note) fail('Expected a note status')
      expect(status.text).toContain('Cycling')
    })
  })
})

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

import {
  createProcessFileHelpers,
  defaultActivityData,
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

describe('processFitnessFileJob best efforts', () => {
  const { database, prepare } = createTestDatabase()
  let actor: Actor

  const { createStatusWithFitnessFile } = createProcessFileHelpers(
    database,
    () => actor
  )

  beforeAll(async () => {
    await prepare()
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

  // A 1 Hz ride: `seconds` of power at `watts`, 8 m/s along a metric track.
  const ride = (seconds: number, watts: number) => ({
    ...defaultActivityData,
    activityType: 'ride',
    trackPoints: [],
    coordinates: [],
    totalDurationSeconds: seconds,
    metricPoints: Array.from({ length: seconds + 1 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 0, 5, 6, 0, index)),
      distanceMeters: index * 8
    })),
    powerSeries: new Array(seconds).fill(watts)
  })

  it('stores the efforts and rewrites them when the file is reprocessed', async () => {
    const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
      text: 'Tempo ride'
    })
    const run = (id: string) =>
      processFitnessFileJob(database, {
        id,
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

    mockParseFitnessFile.mockResolvedValue(ride(400, 250))
    await run('job-best-efforts-1')
    expect(
      await database.getFitnessBestEfforts({ fitnessFileIds: [fitnessFileId] })
    ).toEqual([
      { fitnessFileId, kind: 'power', key: 5, value: 250 },
      { fitnessFileId, kind: 'power', key: 60, value: 250 },
      { fitnessFileId, kind: 'power', key: 300, value: 250 }
    ])

    // A reprocess replaces the rows: a shorter file loses its 300 s effort.
    mockParseFitnessFile.mockResolvedValue(ride(100, 300))
    await run('job-best-efforts-2')
    expect(
      await database.getFitnessBestEfforts({ fitnessFileIds: [fitnessFileId] })
    ).toEqual([
      { fitnessFileId, kind: 'power', key: 5, value: 300 },
      { fitnessFileId, kind: 'power', key: 60, value: 300 }
    ])

    const [record] = await database.getFitnessPersonalRecords({
      actorId: actor.id
    })
    expect(record).toMatchObject({
      fitnessFileId,
      statusId,
      activityDate: defaultActivityData.startTime!.getTime()
    })
  })
})

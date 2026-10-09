import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  importFitnessFiles,
  importFitnessFilesJob
} from '@/lib/jobs/importFitnessFilesJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME
} from '@/lib/jobs/names'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { deleteMediaFile } from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

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

  describe('import notification opt-in', () => {
    const createFile = async (name: string) => {
      const file = await database.createFitnessFile({
        actorId: actor.id,
        path: `fitness/${name}.fit`,
        fileName: `${name}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024,
        importBatchId: 'batch-notify-optin'
      })
      return file!.id
    }

    const stubParse = (count: number) => {
      for (let index = 0; index < count; index += 1) {
        mockParseFitnessFile.mockResolvedValueOnce({
          coordinates: [],
          trackPoints: [],
          totalDistanceMeters: 5_000 + index,
          totalDurationSeconds: 1_500 + index,
          // Distinct start times so the files do not merge as one overlapping
          // activity — the point is several separate imports in one batch.
          startTime: new Date(Date.UTC(2026, 0, 2 + index))
        })
      }
    }

    it('stays silent for a bulk batch that did not opt in', async () => {
      // This job is the funnel for every bulk import: the Strava archive
      // walker, the multi-file upload endpoint, retry-all, the recovery
      // scripts. Each activity in a batch gets its own brand-new status, so
      // inferring "notify" from that alone would mail once per activity — a
      // 500-ride archive import would send 500 emails.
      const fitnessFileIds = await Promise.all([
        createFile('bulk-a'),
        createFile('bulk-b'),
        createFile('bulk-c')
      ])
      stubParse(3)

      await importFitnessFilesJob(database, {
        id: 'job-bulk-silent',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-notify-optin',
          fitnessFileIds
        }
      })

      const publishes = (getQueue().publish as jest.Mock).mock.calls
        .map(([message]) => message)
        .filter((message) => message.name === PROCESS_FITNESS_FILE_JOB_NAME)
      expect(publishes.length).toBeGreaterThan(0)
      for (const message of publishes) {
        expect(message.data.notifyOnComplete).toBe(false)
      }
    })

    it('notifies when the publisher opted in and the status is new', async () => {
      const fitnessFileIds = [await createFile('single-opt-in')]
      stubParse(1)

      await importFitnessFilesJob(database, {
        id: 'job-single-notify',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-notify-optin-single',
          fitnessFileIds,
          notifyOnComplete: true
        }
      })

      const publish = (getQueue().publish as jest.Mock).mock.calls
        .map(([message]) => message)
        .find((message) => message.name === PROCESS_FITNESS_FILE_JOB_NAME)
      expect(publish?.data.notifyOnComplete).toBe(true)
    })
  })

  describe('federation opt-in', () => {
    const createFile = async (name: string) => {
      const file = await database.createFitnessFile({
        actorId: actor.id,
        path: `fitness/${name}.fit`,
        fileName: `${name}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024,
        importBatchId: 'batch-federation-optin'
      })
      return file!.id
    }

    const stubParse = (startDay: number) => {
      mockParseFitnessFile.mockResolvedValueOnce({
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 9_000,
        totalDurationSeconds: 2_400,
        startTime: new Date(Date.UTC(2026, 2, startDay))
      })
    }

    const getProcessJobs = () =>
      (getQueue().publish as jest.Mock).mock.calls
        .map(([message]) => message)
        .filter((message) => message.name === PROCESS_FITNESS_FILE_JOB_NAME)

    it.each([
      {
        description: 'stays local without an opt-in',
        requested: undefined,
        expected: false
      },
      {
        description: 'federates on opt-in',
        requested: true,
        expected: true
      }
    ])('$description', async ({ requested, expected }) => {
      const fitnessFileIds = [await createFile(`optin-${String(requested)}`)]
      stubParse(3)

      await importFitnessFilesJob(database, {
        id: `job-federation-${String(requested)}`,
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-federation-optin',
          fitnessFileIds,
          ...(requested === undefined ? {} : { publishSendNote: requested })
        }
      })

      const publish = getProcessJobs().at(-1)
      expect(publish?.data.publishSendNote).toBe(expected)
    })

    it('does not federate again when the import re-runs over an existing status', async () => {
      // Retries and the recovery scripts re-drive this job over statuses that
      // are already live. Their Create has been delivered, so a second one
      // would post the same ride to every follower twice.
      const fitnessFileIds = [await createFile('rerun')]
      stubParse(6)

      await importFitnessFilesJob(database, {
        id: 'job-federation-first',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-federation-optin',
          fitnessFileIds,
          publishSendNote: true
        }
      })
      expect(getProcessJobs().at(-1)?.data.publishSendNote).toBe(true)

      stubParse(6)
      await importFitnessFilesJob(database, {
        id: 'job-federation-rerun',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-federation-optin',
          fitnessFileIds,
          publishSendNote: true
        }
      })

      expect(getProcessJobs().at(-1)?.data.publishSendNote).toBe(false)
    })

    it('returns the process job instead of publishing it when deferred', async () => {
      const fitnessFileIds = [await createFile('deferred')]
      stubParse(8)

      const groups = await importFitnessFiles(
        database,
        {
          actorId: actor.id,
          batchId: 'batch-federation-optin',
          fitnessFileIds,
          publishSendNote: true
        },
        { deferProcessJobPublishes: true }
      )

      expect(getProcessJobs()).toHaveLength(0)
      expect(groups).toHaveLength(1)
      expect(groups[0].statusCreated).toBe(true)
      expect(groups[0].processJob).toEqual(
        expect.objectContaining({
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: expect.objectContaining({
            statusId: groups[0].statusId,
            fitnessFileId: fitnessFileIds[0],
            publishSendNote: true
          })
        })
      )
    })
  })
})

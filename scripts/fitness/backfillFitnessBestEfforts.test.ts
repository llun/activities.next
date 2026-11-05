import { getDatabase } from '@/lib/database'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import { savePreParsedRouteData } from '@/lib/services/fitness-files/fileRouteDataCache'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import {
  backfillFitnessBestEffortsScript,
  parseArgs
} from './backfillFitnessBestEfforts'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/fitness-files', () => ({
  getFitnessFileBuffer: vi.fn()
}))

vi.mock('@/lib/services/fitness-files/parseFitnessFile', () => ({
  isParseableFitnessFileType: vi.fn().mockReturnValue(true),
  parseFitnessFile: vi.fn()
}))

vi.mock('./describeConnection', () => ({
  printDatabaseBanner: vi.fn()
}))

describe('backfillFitnessBestEfforts parseArgs', () => {
  it('parses actor-id, force, and dry-run flags', () => {
    expect(
      parseArgs(['--actor-id', ACTOR1_ID, '--force', '--dry-run=false'])
    ).toEqual({ actorId: ACTOR1_ID, force: true, dryRun: false })
    expect(() => parseArgs(['--force'])).toThrow()
  })
})

describe('backfillFitnessBestEffortsScript', () => {
  const { database, prepare } = createTestDatabase()
  // The script closes the database it is handed; keep the shared one open.
  const scriptDatabase = { ...database, destroy: vi.fn() } as Database

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    vi.mocked(getDatabase).mockReturnValue(scriptDatabase)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterAll(async () => {
    await database.destroy()
  })

  let sequence = 0
  const createActivity = async ({
    activityType,
    posted = true,
    primary = true
  }: {
    activityType: string
    posted?: boolean
    primary?: boolean
  }) => {
    sequence += 1
    const statusId = `${ACTOR1_ID}/statuses/backfill-${sequence}`
    if (posted) {
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        to: [],
        cc: [],
        text: `Backfill ${sequence}`
      })
    }
    const file = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      ...(posted ? { statusId } : {}),
      path: `fitness/backfill-${sequence}.fit`,
      fileName: `backfill-${sequence}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 128
    })
    await database.updateFitnessFileActivityData(file!.id, {
      activityType,
      activityStartTime: new Date(Date.UTC(2026, 3, sequence))
    })
    await database.updateFitnessFileProcessingStatus(file!.id, 'completed')
    if (!primary) await database.updateFitnessFilePrimary(file!.id, false)
    return { fitnessFileId: file!.id, statusId }
  }

  // A cached 10 minute ride at `watts`, the only new file a run will see.
  const createCachedRide = async (watts: number, primary = true) => {
    const ride = await createActivity({ activityType: 'ride', primary })
    await savePreParsedRouteData(database, {
      fitnessFileId: ride.fitnessFileId,
      actorId: ACTOR1_ID,
      payload: {
        version: 1,
        totalDurationSeconds: 600,
        powerSeries: new Array(600).fill(watts)
      }
    })
    return ride
  }
  const effortsOf = (fitnessFileId: string) =>
    database.getFitnessBestEfforts({ fitnessFileIds: [fitnessFileId] })

  it('fills efforts from the cached route data or the stored file, then resumes', async () => {
    // Cached route data: a 10 minute ride at 240 W.
    const cachedRide = await createActivity({ activityType: 'ride' })
    await savePreParsedRouteData(database, {
      fitnessFileId: cachedRide.fitnessFileId,
      actorId: ACTOR1_ID,
      payload: {
        version: 1,
        totalDurationSeconds: 600,
        powerSeries: new Array(600).fill(240)
      }
    })
    // No cache: parsed from storage, a 1.2 km run at 4 m/s.
    const storedRun = await createActivity({ activityType: 'run' })
    vi.mocked(getFitnessFileBuffer).mockResolvedValue(Buffer.from('fit'))
    vi.mocked(parseFitnessFile).mockResolvedValue({
      coordinates: [],
      trackPoints: [],
      metricPoints: Array.from({ length: 301 }, (_, index) => ({
        timestamp: new Date(Date.UTC(2026, 3, 2, 7, 0, index)),
        distanceMeters: index * 4
      })),
      totalDistanceMeters: 1200,
      totalDurationSeconds: 300,
      activityType: 'run'
    })
    // A file whose post was deleted is left alone.
    const unposted = await createActivity({
      activityType: 'ride',
      posted: false
    })

    const exitCode = await backfillFitnessBestEffortsScript([
      '--actor-id',
      ACTOR1_ID
    ])
    expect(exitCode).toBe(0)

    expect(
      await database.getFitnessBestEfforts({
        fitnessFileIds: [
          cachedRide.fitnessFileId,
          storedRun.fitnessFileId,
          unposted.fitnessFileId
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        {
          fitnessFileId: cachedRide.fitnessFileId,
          kind: 'power',
          key: 300,
          value: 240
        },
        {
          fitnessFileId: storedRun.fitnessFileId,
          kind: 'distance',
          key: 1000,
          value: 250
        }
      ])
    )
    expect(
      (
        await database.getFitnessBestEfforts({
          fitnessFileIds: [unposted.fitnessFileId]
        })
      ).length
    ).toBe(0)
    expect(parseFitnessFile).toHaveBeenCalledTimes(1)
    // The parsed file's route data is cached on the way.
    expect(
      await database.getFitnessFileRouteData({
        fitnessFileId: storedRun.fitnessFileId
      })
    ).not.toBeNull()

    const [record] = await database.getFitnessPersonalRecords({
      actorId: ACTOR1_ID
    })
    expect(record).toMatchObject({
      fitnessFileId: cachedRide.fitnessFileId,
      activityDate: Date.UTC(2026, 3, 1)
    })

    // A second run finds both files done and computes nothing again.
    const save = vi.spyOn(scriptDatabase, 'replaceFitnessBestEfforts')
    expect(
      await backfillFitnessBestEffortsScript(['--actor-id', ACTOR1_ID])
    ).toBe(0)
    expect(save).not.toHaveBeenCalled()
    expect(parseFitnessFile).toHaveBeenCalledTimes(1)
  })

  it('writes nothing on a dry run', async () => {
    const ride = await createCachedRide(200)
    const save = vi.spyOn(scriptDatabase, 'replaceFitnessBestEfforts')
    save.mockClear()

    expect(
      await backfillFitnessBestEffortsScript([
        '--actor-id',
        ACTOR1_ID,
        '--dry-run'
      ])
    ).toBe(0)

    expect(save).not.toHaveBeenCalled()
    expect(await effortsOf(ride.fitnessFileId)).toEqual([])
  })

  it('recomputes a filled file with --force', async () => {
    const ride = await createCachedRide(300)
    await backfillFitnessBestEffortsScript(['--actor-id', ACTOR1_ID])
    expect(await effortsOf(ride.fitnessFileId)).toContainEqual(
      expect.objectContaining({ key: 5, value: 300 })
    )

    // The cache changes under it (a newer parser, say): only --force rereads.
    await savePreParsedRouteData(database, {
      fitnessFileId: ride.fitnessFileId,
      actorId: ACTOR1_ID,
      payload: {
        version: 1,
        totalDurationSeconds: 600,
        powerSeries: new Array(600).fill(350)
      }
    })
    await backfillFitnessBestEffortsScript(['--actor-id', ACTOR1_ID])
    expect(await effortsOf(ride.fitnessFileId)).toContainEqual(
      expect.objectContaining({ key: 5, value: 300 })
    )

    await backfillFitnessBestEffortsScript(['--actor-id', ACTOR1_ID, '--force'])
    expect(await effortsOf(ride.fitnessFileId)).toContainEqual(
      expect.objectContaining({ key: 5, value: 350 })
    )
  })

  it('skips secondary recordings, which never count', async () => {
    const secondary = await createCachedRide(250, false)

    await backfillFitnessBestEffortsScript(['--actor-id', ACTOR1_ID])

    expect(await effortsOf(secondary.fitnessFileId)).toEqual([])
  })
})

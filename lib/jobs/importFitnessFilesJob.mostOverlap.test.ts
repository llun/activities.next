import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { importFitnessFiles } from '@/lib/jobs/importFitnessFilesJob'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { deleteMediaFile } from '@/lib/services/medias'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

import { createImportFileHelpers } from './importFitnessFilesJob.testUtils'

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

// One evening indoors (2026-10-30, CET = UTC+1): a short Rouvy warm-up route,
// then the main Rouvy route, both inside one long trainer recording that has
// no GPS. The trainer recording covers both Rouvy rides completely, so it
// overlaps each of them 100% of the shorter duration.
const route = [
  { lat: 46.0569, lng: 14.5058 },
  { lat: 46.06, lng: 14.51 }
]
const lakePukaki: FitnessActivityData = {
  coordinates: route,
  trackPoints: [],
  totalDistanceMeters: 1_000,
  totalDurationSeconds: 161,
  startTime: new Date('2026-10-30T17:15:19.000Z')
}
const tourOfSlovenia: FitnessActivityData = {
  coordinates: route,
  trackPoints: [],
  totalDistanceMeters: 45_000,
  totalDurationSeconds: 5_428,
  startTime: new Date('2026-10-30T17:20:06.000Z')
}
const indoorCycling: FitnessActivityData = {
  coordinates: [],
  trackPoints: [],
  totalDistanceMeters: 48_000,
  totalDurationSeconds: 6_154,
  startTime: new Date('2026-10-30T17:09:09.000Z')
}

describe('importFitnessFiles same-ride merge with several existing posts', () => {
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

  const { createFitnessFile } = createImportFileHelpers(database, () => actor)

  const importOne = async ({
    name,
    activity,
    overlapFitnessFileIds = []
  }: {
    name: string
    activity: FitnessActivityData
    overlapFitnessFileIds?: string[]
  }) => {
    const file = await createFitnessFile('tcx', `fitness/${name}.tcx`, name)
    mockParseFitnessFile.mockResolvedValueOnce(activity)
    const groups = await importFitnessFiles(database, {
      actorId: actor.id,
      batchId: name,
      fitnessFileIds: [file!.id],
      overlapFitnessFileIds,
      visibility: 'public'
    })
    expect(groups).toHaveLength(1)
    return { fileId: file!.id, statusId: groups[0].statusId }
  }

  const reimport = async ({
    fileId,
    activity,
    overlapFitnessFileIds
  }: {
    fileId: string
    activity: FitnessActivityData
    overlapFitnessFileIds: string[]
  }) => {
    mockParseFitnessFile.mockResolvedValueOnce(activity)
    return importFitnessFiles(database, {
      actorId: actor.id,
      batchId: `retry-${fileId}`,
      fitnessFileIds: [fileId],
      overlapFitnessFileIds,
      visibility: 'public'
    })
  }

  const fileStatusId = async (fileId: string) =>
    (await database.getFitnessFile({ id: fileId }))?.statusId

  it('attaches a trainer recording to the post it overlaps most, not the earliest one', async () => {
    const pukaki = await importOne({
      name: 'most-overlap-last-pukaki',
      activity: lakePukaki
    })
    const slovenia = await importOne({
      name: 'most-overlap-last-slovenia',
      activity: tourOfSlovenia,
      overlapFitnessFileIds: [pukaki.fileId]
    })
    // The two Rouvy rides do not overlap each other, so they are two posts.
    expect(slovenia.statusId).not.toBe(pukaki.statusId)

    const indoor = await importOne({
      name: 'most-overlap-last-indoor',
      activity: indoorCycling,
      overlapFitnessFileIds: [pukaki.fileId, slovenia.fileId]
    })

    // 5,428 s of overlap with Tour of Slovenia against 161 s with Lake Pukaki.
    expect(indoor.statusId).toBe(slovenia.statusId)
    expect(await fileStatusId(indoor.fileId)).toBe(slovenia.statusId)

    // Neither existing post loses or gains anything else.
    expect(await fileStatusId(pukaki.fileId)).toBe(pukaki.statusId)
    expect(await fileStatusId(slovenia.fileId)).toBe(slovenia.statusId)
    expect(
      (
        await database.getFitnessFilesByStatus({ statusId: pukaki.statusId })
      ).map((file) => file.id)
    ).toEqual([pukaki.fileId])

    // The Rouvy file keeps the route map: the GPS-less recording joins as a
    // secondary.
    expect(await database.getFitnessFile({ id: slovenia.fileId })).toEqual(
      expect.objectContaining({ isPrimary: true })
    )
    expect(await database.getFitnessFile({ id: indoor.fileId })).toEqual(
      expect.objectContaining({ isPrimary: false })
    )
  })

  it('ties go to the earliest existing post', async () => {
    // Two existing posts of 600 s each, back to back, both fully inside a new
    // 1,200 s recording: equal overlap, so the earlier post wins.
    const first = await importOne({
      name: 'most-overlap-tie-first',
      activity: {
        ...lakePukaki,
        totalDurationSeconds: 600,
        startTime: new Date('2026-10-29T10:00:00.000Z')
      }
    })
    const second = await importOne({
      name: 'most-overlap-tie-second',
      activity: {
        ...lakePukaki,
        totalDurationSeconds: 600,
        startTime: new Date('2026-10-29T10:10:00.000Z')
      },
      overlapFitnessFileIds: [first.fileId]
    })
    expect(second.statusId).not.toBe(first.statusId)

    const whole = await importOne({
      name: 'most-overlap-tie-whole',
      activity: {
        ...indoorCycling,
        totalDurationSeconds: 1_200,
        startTime: new Date('2026-10-29T10:00:00.000Z')
      },
      overlapFitnessFileIds: [second.fileId, first.fileId]
    })

    expect(whole.statusId).toBe(first.statusId)
    expect(await fileStatusId(second.fileId)).toBe(second.statusId)
  })

  it('never moves a re-imported file off the post it already belongs to', async () => {
    const indoor = await importOne({
      name: 'most-overlap-keep-indoor',
      activity: {
        ...indoorCycling,
        startTime: new Date('2026-10-28T17:09:09.000Z')
      }
    })
    // A separate post for the same evening, created without the trainer
    // recording as context (for example before the trainer one was imported
    // on another path).
    const slovenia = await importOne({
      name: 'most-overlap-keep-slovenia',
      activity: {
        ...tourOfSlovenia,
        startTime: new Date('2026-10-28T17:20:06.000Z')
      }
    })
    expect(slovenia.statusId).not.toBe(indoor.statusId)

    // A retry of the Rouvy file now sees the earlier trainer post as context.
    const groups = await reimport({
      fileId: slovenia.fileId,
      activity: {
        ...tourOfSlovenia,
        startTime: new Date('2026-10-28T17:20:06.000Z')
      },
      overlapFitnessFileIds: [indoor.fileId]
    })

    expect(groups.map((group) => group.statusId)).toEqual([slovenia.statusId])
    expect(await fileStatusId(slovenia.fileId)).toBe(slovenia.statusId)
    expect(await fileStatusId(indoor.fileId)).toBe(indoor.statusId)
  })
})

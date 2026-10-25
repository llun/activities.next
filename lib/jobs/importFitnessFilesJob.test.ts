import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  importFitnessFiles,
  importFitnessFilesJob
} from '@/lib/jobs/importFitnessFilesJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { deleteMediaFile } from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getPublicIdTimestamp, isPublicId } from '@/lib/utils/publicId'

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

describe('importFitnessFilesJob', () => {
  const { database, db, prepare } = createTestDatabase()
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

  const { createFitnessFile, routedActivity } = createImportFileHelpers(
    database,
    () => actor
  )

  it('keeps a moved actor import in fitness without publishing a post', async () => {
    const file = await createFitnessFile('fit', 'fitness/moved.fit', 'moved')
    mockParseFitnessFile.mockResolvedValue({
      ...routedActivity,
      coordinates: [],
      activityType: 'Running'
    })
    // The queued import carries only the id; the move happens after enqueue.
    const data = {
      actorId: actor.id,
      batchId: 'moved',
      fitnessFileIds: [file!.id],
      visibility: 'public' as const,
      publishSendNote: true,
      notifyOnComplete: true
    }
    await database.updateActor({
      actorId: actor.id,
      movedTo: 'https://destination.test/users/athlete'
    })
    try {
      const [group] = await importFitnessFiles(database, data)
      expect(group.processJob).toEqual(
        expect.objectContaining({
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: expect.objectContaining({
            publishSendNote: false,
            notifyOnComplete: false
          })
        })
      )
      await processFitnessFileJob(database, group.processJob!)

      const imported = await database.getFitnessFile({ id: file!.id })
      expect(imported).toEqual(
        expect.objectContaining({
          statusId: group.statusId,
          importStatus: 'completed',
          processingStatus: 'completed',
          totalDistanceMeters: routedActivity.totalDistanceMeters
        })
      )
      const status = await database.getStatus({ statusId: group.statusId })
      expect(status).toEqual(expect.objectContaining({ to: [], cc: [] }))
      expect(
        await canActorReadStatus({
          database,
          status: status!,
          currentActor: null
        })
      ).toBe(false)
      expect(
        await canActorReadStatus({
          database,
          status: status!,
          currentActor: actor
        })
      ).toBe(true)
      expect(
        await canActorReadStatus({
          database,
          status: status!,
          currentActor: { ...actor, id: 'https://follower.test/users/friend' },
          isFollower: true
        })
      ).toBe(false)
      expect(
        await database.getActorStatuses({ actorId: actor.id, publicOnly: true })
      ).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: group.statusId })
        ])
      )
      expect(
        await db
          .selectFrom('timelines')
          .selectAll()
          .where('statusId', '=', group.statusId)
          .execute()
      ).toEqual([])
      const page = await database.getFitnessActivitiesInWindow({
        actorId: actor.id,
        startDate: Date.parse('2026-02-01T00:00:00Z'),
        endDate: Date.parse('2026-02-02T00:00:00Z'),
        limit: 100,
        offset: 0
      })
      expect(page.activities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: file!.id, statusId: group.statusId })
        ])
      )
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith(group.processJob)
    } finally {
      await database.updateActor({ actorId: actor.id, movedTo: null })
    }
  })

  it('posts an overlapping import after a redirect is cleared and leaves the moved import hidden', async () => {
    const hiddenFile = await createFitnessFile(
      'fit',
      'fitness/hidden-overlap-before-clear.fit',
      'hidden-overlap-before-clear'
    )
    const newFile = await createFitnessFile(
      'fit',
      'fitness/public-overlap-after-clear.fit',
      'public-overlap-after-clear'
    )
    mockParseFitnessFile.mockResolvedValue(routedActivity)
    await database.updateActor({
      actorId: actor.id,
      movedTo: 'https://destination.test/users/athlete'
    })
    try {
      const [hidden] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'hidden-overlap-before-clear',
        fitnessFileIds: [hiddenFile!.id],
        visibility: 'public',
        publishSendNote: true
      })
      await processFitnessFileJob(database, hidden.processJob!)
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )

      await database.updateActor({ actorId: actor.id, movedTo: null })
      const [published] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'public-overlap-after-clear',
        fitnessFileIds: [newFile!.id],
        overlapFitnessFileIds: [hiddenFile!.id],
        visibility: 'public',
        publishSendNote: true
      })
      expect(published.statusId).not.toBe(hidden.statusId)
      expect(published.statusCreated).toBe(true)
      expect(published.processJob?.data).toEqual(
        expect.objectContaining({ publishSendNote: true })
      )
      await processFitnessFileJob(database, published.processJob!)

      expect(await database.getFitnessFile({ id: hiddenFile!.id })).toEqual(
        expect.objectContaining({ statusId: hidden.statusId })
      )
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )
      expect(
        await db
          .selectFrom('timelines')
          .selectAll()
          .where('statusId', '=', hidden.statusId)
          .execute()
      ).toEqual([])
      expect(
        await database.getStatus({ statusId: published.statusId })
      ).toEqual(expect.objectContaining({ to: [ACTIVITY_STREAM_PUBLIC] }))
      expect(
        await db
          .selectFrom('timelines')
          .selectAll()
          .where('statusId', '=', published.statusId)
          .execute()
      ).not.toEqual([])
      expect(getQueue().publish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: SEND_NOTE_JOB_NAME,
          data: expect.objectContaining({ statusId: published.statusId })
        })
      )
    } finally {
      await database.updateActor({ actorId: actor.id, movedTo: null })
    }
  })

  it('lands a Wahoo revision on the hidden status a moved-time import left behind', async () => {
    const earlierFile = await createFitnessFile(
      'fit',
      'fitness/wahoo-revision-hidden-earlier.fit',
      'wahoo-revision-hidden'
    )
    const latestFile = await createFitnessFile(
      'fit',
      'fitness/wahoo-revision-hidden-latest.fit',
      'wahoo-revision-hidden'
    )
    mockParseFitnessFile.mockResolvedValue(routedActivity)
    await database.updateActor({
      actorId: actor.id,
      movedTo: 'https://destination.test/users/athlete'
    })
    try {
      const [hidden] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'wahoo-revision-hidden',
        fitnessFileIds: [earlierFile!.id],
        visibility: 'public',
        publishSendNote: true
      })
      await processFitnessFileJob(database, hidden.processJob!)
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )

      await database.updateActor({ actorId: actor.id, movedTo: null })
      // Wahoo resends edited FIT bytes for the same workout: the previous
      // file rides along as an overlap candidate, and the revision names the
      // status it must land on. It is not a new recording, so the hidden
      // status is not isolated from it.
      const groups = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'wahoo-revision-hidden',
        fitnessFileIds: [latestFile!.id],
        overlapFitnessFileIds: [earlierFile!.id],
        visibility: 'public',
        publishSendNote: true,
        replacePrimaryFileId: earlierFile!.id,
        expectedExistingStatusId: hidden.statusId
      })
      expect(groups).toHaveLength(1)
      const [revision] = groups
      expect(revision.statusId).toBe(hidden.statusId)
      expect(revision.statusCreated).toBe(false)
      expect(revision.primaryFitnessFileId).toBe(latestFile!.id)
      expect(await database.getFitnessFile({ id: latestFile!.id })).toEqual(
        expect.objectContaining({
          statusId: hidden.statusId,
          isPrimary: true
        })
      )
      expect(await database.getFitnessFile({ id: earlierFile!.id })).toEqual(
        expect.objectContaining({
          statusId: hidden.statusId,
          isPrimary: false
        })
      )
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )
    } finally {
      await database.updateActor({ actorId: actor.id, movedTo: null })
    }
  })

  it('lands a replacePrimaryFileId-only revision on the hidden status a moved-time import left behind', async () => {
    const earlierFile = await createFitnessFile(
      'fit',
      'fitness/wahoo-revision-replace-only-earlier.fit',
      'wahoo-revision-replace-only'
    )
    const latestFile = await createFitnessFile(
      'fit',
      'fitness/wahoo-revision-replace-only-latest.fit',
      'wahoo-revision-replace-only'
    )
    mockParseFitnessFile.mockResolvedValue(routedActivity)
    await database.updateActor({
      actorId: actor.id,
      movedTo: 'https://destination.test/users/athlete'
    })
    try {
      const [hidden] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'wahoo-revision-replace-only',
        fitnessFileIds: [earlierFile!.id],
        visibility: 'public',
        publishSendNote: true
      })
      await processFitnessFileJob(database, hidden.processJob!)

      await database.updateActor({ actorId: actor.id, movedTo: null })
      // The Wahoo job crashed after the status was assigned but before it
      // recorded the import, so the retry knows only the file whose status
      // the revision replaces — no expectedExistingStatusId. The hidden
      // status must still be exempt from isolation, or the revision would
      // publish a duplicate post for the same ride.
      const groups = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'wahoo-revision-replace-only',
        fitnessFileIds: [latestFile!.id],
        overlapFitnessFileIds: [earlierFile!.id],
        visibility: 'public',
        publishSendNote: true,
        replacePrimaryFileId: earlierFile!.id
      })
      expect(groups).toHaveLength(1)
      const [revision] = groups
      expect(revision.statusId).toBe(hidden.statusId)
      expect(revision.statusCreated).toBe(false)
      expect(revision.primaryFitnessFileId).toBe(latestFile!.id)
      expect(await database.getFitnessFile({ id: latestFile!.id })).toEqual(
        expect.objectContaining({
          statusId: hidden.statusId,
          isPrimary: true
        })
      )
      expect(await database.getFitnessFile({ id: earlierFile!.id })).toEqual(
        expect.objectContaining({
          statusId: hidden.statusId,
          isPrimary: false
        })
      )
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )
    } finally {
      await database.updateActor({ actorId: actor.id, movedTo: null })
    }
  })

  it('merges a later import into a moved-time status the owner published after the clear', async () => {
    const hiddenFile = await createFitnessFile(
      'fit',
      'fitness/hidden-published-after-clear.fit',
      'hidden-published-after-clear'
    )
    const newFile = await createFitnessFile(
      'fit',
      'fitness/overlap-into-published.fit',
      'overlap-into-published'
    )
    mockParseFitnessFile.mockResolvedValue(routedActivity)
    await database.updateActor({
      actorId: actor.id,
      movedTo: 'https://destination.test/users/athlete'
    })
    try {
      const [hidden] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'hidden-published-after-clear',
        fitnessFileIds: [hiddenFile!.id],
        visibility: 'public',
        publishSendNote: true
      })
      await processFitnessFileJob(database, hidden.processJob!)
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )

      await database.updateActor({ actorId: actor.id, movedTo: null })
      // The post menu's visibility control (PUT /api/v1/statuses/:id) runs
      // updateNoteVisibility: a visibility change that changes the audience
      // clears the createdWhileMoved marker, so the status is an ordinary
      // post.
      await database.updateNoteVisibility({
        statusId: hidden.statusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const published = await database.getStatus({
        statusId: hidden.statusId
      })
      expect(published).toEqual(
        expect.objectContaining({ to: [ACTIVITY_STREAM_PUBLIC] })
      )
      expect(published).not.toHaveProperty('createdWhileMoved')

      const [merged] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'overlap-into-published',
        fitnessFileIds: [newFile!.id],
        overlapFitnessFileIds: [hiddenFile!.id],
        visibility: 'public',
        publishSendNote: true
      })
      // The published status merges like any post: the overlapping import
      // attaches to it instead of creating a second public post for the ride.
      expect(merged.statusId).toBe(hidden.statusId)
      expect(merged.statusCreated).toBe(false)
      expect(await database.getFitnessFile({ id: newFile!.id })).toEqual(
        expect.objectContaining({ statusId: hidden.statusId })
      )
    } finally {
      await database.updateActor({ actorId: actor.id, movedTo: null })
    }
  })

  it('merges a later public import into a moved-time status the owner set to direct after the clear', async () => {
    const hiddenFile = await createFitnessFile(
      'fit',
      'fitness/hidden-set-direct-after-clear.fit',
      'hidden-set-direct-after-clear'
    )
    const newFile = await createFitnessFile(
      'fit',
      'fitness/public-overlap-into-direct.fit',
      'public-overlap-into-direct'
    )
    mockParseFitnessFile.mockResolvedValue(routedActivity)
    await database.updateActor({
      actorId: actor.id,
      movedTo: 'https://destination.test/users/athlete'
    })
    try {
      const [hidden] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'hidden-set-direct-after-clear',
        fitnessFileIds: [hiddenFile!.id],
        visibility: 'public',
        publishSendNote: true
      })
      await processFitnessFileJob(database, hidden.processJob!)
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )

      await database.updateActor({ actorId: actor.id, movedTo: null })
      // Publishing, then changing the mind to direct, both run
      // updateNoteVisibility — and each changes the audience, which clears
      // the marker, so the status is an ordinary direct post, not a
      // still-hidden moved-time record.
      await database.updateNoteVisibility({
        statusId: hidden.statusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.updateNoteVisibility({
        statusId: hidden.statusId,
        to: [],
        cc: []
      })
      const direct = await database.getStatus({
        statusId: hidden.statusId
      })
      expect(direct).toEqual(expect.objectContaining({ to: [], cc: [] }))
      expect(direct).not.toHaveProperty('createdWhileMoved')

      const [merged] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'public-overlap-into-direct',
        fitnessFileIds: [newFile!.id],
        overlapFitnessFileIds: [hiddenFile!.id],
        visibility: 'public',
        publishSendNote: true
      })
      // The direct status merges like any direct import: the overlapping
      // public import attaches to it instead of creating a second, public
      // post for a ride the owner made private.
      expect(merged.statusId).toBe(hidden.statusId)
      expect(merged.statusCreated).toBe(false)
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )
      expect(await database.getFitnessFile({ id: newFile!.id })).toEqual(
        expect.objectContaining({ statusId: hidden.statusId })
      )
      expect(getQueue().publish).not.toHaveBeenCalledWith(
        expect.objectContaining({
          name: SEND_NOTE_JOB_NAME,
          data: expect.objectContaining({ statusId: hidden.statusId })
        })
      )
    } finally {
      await database.updateActor({ actorId: actor.id, movedTo: null })
    }
  })

  it.each([false, true])(
    'does not expose a moved actor new file through a pre-move post (reprocess original: %s)',
    async (reprocessOriginal) => {
      const original = await createFitnessFile(
        'fit',
        `fitness/before-move-${reprocessOriginal}.fit`,
        'before-move'
      )
      mockParseFitnessFile.mockResolvedValue(routedActivity)
      const [published] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'before-move',
        fitnessFileIds: [original!.id],
        visibility: 'public'
      })
      const additional = await createFitnessFile(
        'fit',
        `fitness/after-move-${reprocessOriginal}.fit`,
        'after-move'
      )
      await database.updateActor({
        actorId: actor.id,
        movedTo: 'https://destination.test/users/athlete'
      })
      try {
        const [imported] = await importFitnessFiles(database, {
          actorId: actor.id,
          batchId: 'after-move',
          fitnessFileIds: reprocessOriginal
            ? [original!.id, additional!.id]
            : [additional!.id],
          overlapFitnessFileIds: [original!.id],
          visibility: 'public',
          publishSendNote: true
        })
        expect(imported.statusId).not.toBe(published.statusId)
        expect(
          await database.getStatus({ statusId: imported.statusId })
        ).toEqual(expect.objectContaining({ to: [], cc: [] }))
        expect(await database.getFitnessFile({ id: original!.id })).toEqual(
          expect.objectContaining({ statusId: published.statusId })
        )
        // Reprocessing the historical recording preserves its original post.
        const [reprocessed] = await importFitnessFiles(database, {
          actorId: actor.id,
          batchId: 'before-move',
          fitnessFileIds: [original!.id],
          visibility: 'public',
          publishSendNote: true
        })
        expect(reprocessed.statusId).toBe(published.statusId)
        expect(reprocessed.processJob?.data).toEqual(
          expect.objectContaining({ publishSendNote: false })
        )
      } finally {
        await database.updateActor({ actorId: actor.id, movedTo: null })
      }
    }
  )

  it('lands a Wahoo revision on a pre-move post while the account is moved without publishing', async () => {
    const earlierFile = await createFitnessFile(
      'fit',
      'fitness/wahoo-revision-premove-earlier.fit',
      'wahoo-revision-premove'
    )
    const latestFile = await createFitnessFile(
      'fit',
      'fitness/wahoo-revision-premove-latest.fit',
      'wahoo-revision-premove'
    )
    mockParseFitnessFile.mockResolvedValue(routedActivity)
    const [published] = await importFitnessFiles(database, {
      actorId: actor.id,
      batchId: 'wahoo-revision-premove',
      fitnessFileIds: [earlierFile!.id],
      visibility: 'public'
    })
    expect(await database.getStatus({ statusId: published.statusId })).toEqual(
      expect.objectContaining({ to: [ACTIVITY_STREAM_PUBLIC] })
    )

    await database.updateActor({
      actorId: actor.id,
      movedTo: 'https://destination.test/users/athlete'
    })
    try {
      ;(getQueue().publish as jest.Mock).mockClear()
      // The revision is the same workout as the pre-move post, not a new
      // recording, so it stays on that post instead of being isolated into
      // its own group.
      const [revision] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'wahoo-revision-premove',
        fitnessFileIds: [latestFile!.id],
        overlapFitnessFileIds: [earlierFile!.id],
        visibility: 'public',
        publishSendNote: true,
        replacePrimaryFileId: earlierFile!.id,
        expectedExistingStatusId: published.statusId
      })
      expect(revision.statusId).toBe(published.statusId)
      expect(revision.statusCreated).toBe(false)
      expect(revision.primaryFitnessFileId).toBe(latestFile!.id)
      expect(revision.processJob?.data).toEqual(
        expect.objectContaining({ publishSendNote: false })
      )
      expect(await database.getFitnessFile({ id: latestFile!.id })).toEqual(
        expect.objectContaining({
          statusId: published.statusId,
          isPrimary: true
        })
      )
      expect(await database.getFitnessFile({ id: earlierFile!.id })).toEqual(
        expect.objectContaining({
          statusId: published.statusId,
          isPrimary: false
        })
      )

      await processFitnessFileJob(database, revision.processJob!)
      expect(getQueue().publish).not.toHaveBeenCalledWith(
        expect.objectContaining({
          name: SEND_NOTE_JOB_NAME,
          data: expect.objectContaining({ statusId: published.statusId })
        })
      )
      // The revision exposes nothing new through the post: its audience is
      // untouched.
      expect(
        await database.getStatus({ statusId: published.statusId })
      ).toEqual(expect.objectContaining({ to: [ACTIVITY_STREAM_PUBLIC] }))
    } finally {
      await database.updateActor({ actorId: actor.id, movedTo: null })
    }
  })

  it('lands a revision on its hidden status when a pre-move post of the same ride overlaps it', async () => {
    const preMoveFile = await createFitnessFile(
      'fit',
      'fitness/revision-overlapping-statuses-premove.fit',
      'revision-overlapping-statuses-premove'
    )
    const movedFile = await createFitnessFile(
      'fit',
      'fitness/revision-overlapping-statuses-moved.fit',
      'revision-overlapping-statuses-moved'
    )
    const latestFile = await createFitnessFile(
      'fit',
      'fitness/revision-overlapping-statuses-latest.fit',
      'revision-overlapping-statuses-latest'
    )
    // The pre-move recording starts ten minutes before the moved-time one;
    // both overlap by >=80%, so after the clear they are one overlap group.
    const movedTimeActivity = {
      ...routedActivity,
      startTime: new Date('2026-02-01T08:10:00.000Z')
    }
    mockParseFitnessFile.mockResolvedValue(routedActivity)
    const [published] = await importFitnessFiles(database, {
      actorId: actor.id,
      batchId: 'revision-overlapping-statuses-premove',
      fitnessFileIds: [preMoveFile!.id],
      visibility: 'public',
      publishSendNote: true
    })
    expect(await database.getStatus({ statusId: published.statusId })).toEqual(
      expect.objectContaining({ to: [ACTIVITY_STREAM_PUBLIC] })
    )

    await database.updateActor({
      actorId: actor.id,
      movedTo: 'https://destination.test/users/athlete'
    })
    try {
      mockParseFitnessFile.mockResolvedValue(movedTimeActivity)
      const [hidden] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'revision-overlapping-statuses-moved',
        fitnessFileIds: [movedFile!.id],
        overlapFitnessFileIds: [preMoveFile!.id],
        visibility: 'public',
        publishSendNote: true
      })
      expect(hidden.statusId).not.toBe(published.statusId)
      await processFitnessFileJob(database, hidden.processJob!)
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )

      await database.updateActor({ actorId: actor.id, movedTo: null })
      // The revision names the hidden status, and the pre-move post's file
      // starts earlier — the group must still pick the revision's status, not
      // the earliest file's, or the revision would fail instead of landing.
      const groups = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'revision-overlapping-statuses-latest',
        fitnessFileIds: [latestFile!.id],
        overlapFitnessFileIds: [preMoveFile!.id, movedFile!.id],
        visibility: 'public',
        publishSendNote: true,
        replacePrimaryFileId: movedFile!.id,
        expectedExistingStatusId: hidden.statusId
      })
      expect(groups).toHaveLength(1)
      const [revision] = groups
      expect(revision.statusId).toBe(hidden.statusId)
      expect(revision.statusCreated).toBe(false)
      expect(revision.primaryFitnessFileId).toBe(latestFile!.id)
      expect(await database.getFitnessFile({ id: latestFile!.id })).toEqual(
        expect.objectContaining({
          statusId: hidden.statusId,
          isPrimary: true
        })
      )
      expect(await database.getFitnessFile({ id: movedFile!.id })).toEqual(
        expect.objectContaining({
          statusId: hidden.statusId,
          isPrimary: false
        })
      )
      // The pre-move post is untouched: its file keeps its status and stays
      // primary, and the post keeps its audience.
      expect(await database.getFitnessFile({ id: preMoveFile!.id })).toEqual(
        expect.objectContaining({
          statusId: published.statusId,
          isPrimary: true
        })
      )
      expect(
        await database.getStatus({ statusId: published.statusId })
      ).toEqual(expect.objectContaining({ to: [ACTIVITY_STREAM_PUBLIC] }))
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )
    } finally {
      await database.updateActor({ actorId: actor.id, movedTo: null })
    }
  })

  it('lands a revision on its pre-move post while moved when a hidden moved-time record of the same ride overlaps it', async () => {
    const preMoveFile = await createFitnessFile(
      'fit',
      'fitness/revision-overlapping-moved-premove.fit',
      'revision-overlapping-moved-premove'
    )
    const movedFile = await createFitnessFile(
      'fit',
      'fitness/revision-overlapping-moved-record.fit',
      'revision-overlapping-moved-record'
    )
    const latestFile = await createFitnessFile(
      'fit',
      'fitness/revision-overlapping-moved-latest.fit',
      'revision-overlapping-moved-latest'
    )
    // The moved-time recording starts five minutes before the pre-move post;
    // both overlap by >=80%, so while moved they are one overlap group once the
    // revision exempts the post it names.
    const earlierMovedActivity = {
      ...routedActivity,
      startTime: new Date('2026-02-01T07:55:00.000Z')
    }
    mockParseFitnessFile.mockResolvedValue(routedActivity)
    const [published] = await importFitnessFiles(database, {
      actorId: actor.id,
      batchId: 'revision-overlapping-moved-premove',
      fitnessFileIds: [preMoveFile!.id],
      visibility: 'public'
    })
    expect(await database.getStatus({ statusId: published.statusId })).toEqual(
      expect.objectContaining({ to: [ACTIVITY_STREAM_PUBLIC] })
    )

    await database.updateActor({
      actorId: actor.id,
      movedTo: 'https://destination.test/users/athlete'
    })
    try {
      mockParseFitnessFile.mockResolvedValue(earlierMovedActivity)
      const [hidden] = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'revision-overlapping-moved-record',
        fitnessFileIds: [movedFile!.id],
        overlapFitnessFileIds: [preMoveFile!.id],
        visibility: 'public',
        publishSendNote: true
      })
      expect(hidden.statusId).not.toBe(published.statusId)
      await processFitnessFileJob(database, hidden.processJob!)
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )

      ;(getQueue().publish as jest.Mock).mockClear()
      mockParseFitnessFile.mockResolvedValue(routedActivity)
      // Still moved: the revision names the pre-move post, and the hidden
      // record's file starts earlier — the group must still pick the
      // revision's status, and the revision must publish nothing new.
      const groups = await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'revision-overlapping-moved-latest',
        fitnessFileIds: [latestFile!.id],
        overlapFitnessFileIds: [preMoveFile!.id, movedFile!.id],
        visibility: 'public',
        publishSendNote: true,
        replacePrimaryFileId: preMoveFile!.id,
        expectedExistingStatusId: published.statusId
      })
      expect(groups).toHaveLength(1)
      const [revision] = groups
      expect(revision.statusId).toBe(published.statusId)
      expect(revision.statusCreated).toBe(false)
      expect(revision.primaryFitnessFileId).toBe(latestFile!.id)
      expect(revision.processJob?.data).toEqual(
        expect.objectContaining({ publishSendNote: false })
      )
      expect(await database.getFitnessFile({ id: latestFile!.id })).toEqual(
        expect.objectContaining({
          statusId: published.statusId,
          isPrimary: true
        })
      )
      expect(await database.getFitnessFile({ id: preMoveFile!.id })).toEqual(
        expect.objectContaining({
          statusId: published.statusId,
          isPrimary: false
        })
      )
      // The hidden moved-time record is untouched.
      expect(await database.getFitnessFile({ id: movedFile!.id })).toEqual(
        expect.objectContaining({
          statusId: hidden.statusId,
          isPrimary: true
        })
      )
      expect(await database.getStatus({ statusId: hidden.statusId })).toEqual(
        expect.objectContaining({ to: [], cc: [] })
      )

      await processFitnessFileJob(database, revision.processJob!)
      expect(getQueue().publish).not.toHaveBeenCalledWith(
        expect.objectContaining({
          name: SEND_NOTE_JOB_NAME,
          data: expect.objectContaining({ statusId: published.statusId })
        })
      )
      expect(
        await database.getStatus({ statusId: published.statusId })
      ).toEqual(expect.objectContaining({ to: [ACTIVITY_STREAM_PUBLIC] }))
    } finally {
      await database.updateActor({ actorId: actor.id, movedTo: null })
    }
  })

  it('merges two direct imports from an account that never moved', async () => {
    const firstFile = await createFitnessFile(
      'fit',
      'fitness/direct-merge-first.fit',
      'direct-merge-first'
    )
    const secondFile = await createFitnessFile(
      'fit',
      'fitness/direct-merge-second.fit',
      'direct-merge-second'
    )
    mockParseFitnessFile.mockResolvedValue(routedActivity)

    const [first] = await importFitnessFiles(database, {
      actorId: actor.id,
      batchId: 'direct-merge-first',
      fitnessFileIds: [firstFile!.id],
      visibility: 'direct'
    })
    // A direct import with no mentions addresses nobody, exactly like a
    // moved-time hidden status; only the createdWhileMoved marker separates
    // the two, and this account never moved.
    expect(await database.getStatus({ statusId: first.statusId })).toEqual(
      expect.objectContaining({ to: [], cc: [] })
    )

    const [second] = await importFitnessFiles(database, {
      actorId: actor.id,
      batchId: 'direct-merge-second',
      fitnessFileIds: [secondFile!.id],
      overlapFitnessFileIds: [firstFile!.id],
      visibility: 'direct'
    })
    expect(second.statusId).toBe(first.statusId)
    expect(second.statusCreated).toBe(false)
    expect(await database.getFitnessFile({ id: secondFile!.id })).toEqual(
      expect.objectContaining({ statusId: first.statusId })
    )
  })

  it('merges a later public import into an older direct import of the same ride', async () => {
    const directFile = await createFitnessFile(
      'fit',
      'fitness/direct-before-public.fit',
      'direct-before-public'
    )
    const publicFile = await createFitnessFile(
      'fit',
      'fitness/public-after-direct.fit',
      'public-after-direct'
    )
    mockParseFitnessFile.mockResolvedValue(routedActivity)

    const [direct] = await importFitnessFiles(database, {
      actorId: actor.id,
      batchId: 'direct-before-public',
      fitnessFileIds: [directFile!.id],
      visibility: 'direct'
    })

    const [merged] = await importFitnessFiles(database, {
      actorId: actor.id,
      batchId: 'public-after-direct',
      fitnessFileIds: [publicFile!.id],
      overlapFitnessFileIds: [directFile!.id],
      visibility: 'public',
      publishSendNote: true
    })
    // The ride the user kept private stays on its one direct status: no
    // separate public post is created for the later import.
    expect(merged.statusId).toBe(direct.statusId)
    expect(merged.statusCreated).toBe(false)
    expect(await database.getStatus({ statusId: direct.statusId })).toEqual(
      expect.objectContaining({ to: [], cc: [] })
    )
    expect(await database.getFitnessFile({ id: publicFile!.id })).toEqual(
      expect.objectContaining({ statusId: direct.statusId })
    )
    expect(getQueue().publish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: SEND_NOTE_JOB_NAME,
        data: expect.objectContaining({ statusId: direct.statusId })
      })
    )
  })

  it('records a reason when status creation rejects with a non-Error', async () => {
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/non-error-throw.fit',
      fileName: 'non-error-throw.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-non-error-throw'
    })

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 1_000,
      totalDurationSeconds: 600,
      startTime: new Date('2026-01-09T00:00:00.000Z')
    })

    // The queue SDK can reject with a non-Error. `(error as Error).message` is
    // undefined for it, which writes importError as NULL and leaves the file
    // failed with no explanation.
    ;(getQueue().publish as jest.Mock).mockRejectedValueOnce('queue exploded')

    await importFitnessFilesJob(database, {
      id: 'import-job-non-error-throw',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-non-error-throw',
        fitnessFileIds: [file!.id],
        visibility: 'public'
      }
    })

    const updated = await database.getFitnessFile({ id: file!.id })
    expect(updated?.importStatus).toBe('failed')
    expect(updated?.importError).toBe('queue exploded')
  })

  it('drops a stale route map email copy when a file is re-imported', async () => {
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/reimport-email-copy.fit',
      fileName: 'reimport-email-copy.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-reimport-email-copy'
    })
    expect(file).toBeDefined()

    // A previous import of this row emailed the owner and stored a JPEG copy of
    // its map.
    await database.updateFitnessFileActivityData(file!.id, {
      hasMapData: true,
      mapImagePath: 'medias/2026-07-26/old-route-map.webp',
      mapImageEmailPath: 'medias/2026-07-26/old-route-map.jpg'
    })

    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 51.5007, lng: -0.1246 },
        { lat: 51.5033, lng: -0.1195 }
      ],
      trackPoints: [],
      totalDistanceMeters: 4_000,
      totalDurationSeconds: 1_200,
      activityType: 'running',
      startTime: new Date('2026-02-01T07:00:00.000Z')
    })

    await importFitnessFilesJob(database, {
      id: 'job-reimport-email-copy',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-reimport-email-copy',
        fitnessFileIds: [file!.id]
      }
    })

    // The reset below de-references the copy; a file that ends up non-primary
    // never reaches processFitnessFileJob to rewrite it, so the object would be
    // orphaned with nothing able to find it.
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      database,
      'medias/2026-07-26/old-route-map.jpg'
    )
    const updated = await database.getFitnessFile({ id: file!.id })
    expect(updated?.mapImagePath).toBeUndefined()
    expect(updated?.mapImageEmailPath).toBeUndefined()
  })

  describe('importing two overlapping files', () => {
    let importRun = 0
    let firstFileId: string
    let secondFileId: string
    let firstActivity: FitnessActivityData

    beforeEach(async () => {
      importRun += 1
      const batchId = `batch-overlap-${importRun}`
      const firstFile = await createFitnessFile(
        'fit',
        `fitness/import-overlap-${importRun}-a.fit`,
        batchId
      )
      const secondFile = await createFitnessFile(
        'fit',
        `fitness/import-overlap-${importRun}-b.fit`,
        batchId
      )

      expect(firstFile).toBeDefined()
      expect(secondFile).toBeDefined()
      firstFileId = firstFile!.id
      secondFileId = secondFile!.id

      firstActivity = {
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 5_000,
        totalDurationSeconds: 1_000,
        startTime: new Date('2026-01-01T00:00:00.000Z')
      }
      const secondActivity: FitnessActivityData = {
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 4_500,
        totalDurationSeconds: 1_000,
        startTime: new Date('2026-01-01T00:03:20.000Z')
      }

      mockParseFitnessFile
        .mockResolvedValueOnce(firstActivity)
        .mockResolvedValueOnce(secondActivity)

      await importFitnessFilesJob(database, {
        id: 'import-job-1',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId,
          fitnessFileIds: [firstFileId, secondFileId],
          visibility: 'public'
        }
      })
    })

    it('merges two overlapping files into one status and marks the first primary', async () => {
      const updatedFirst = await database.getFitnessFile({ id: firstFileId })
      const updatedSecond = await database.getFitnessFile({ id: secondFileId })

      expect(updatedFirst?.statusId).toBeDefined()
      expect(updatedSecond?.statusId).toBe(updatedFirst?.statusId)
      expect(updatedFirst?.isPrimary).toBe(true)
      expect(updatedSecond?.isPrimary).toBe(false)
      expect(updatedFirst?.importStatus).toBe('completed')
      expect(updatedSecond?.importStatus).toBe('completed')
      expect(updatedSecond?.processingStatus).toBe('completed')

      const status = await database.getStatus({
        statusId: updatedFirst!.statusId!,
        withReplies: false
      })
      expect(status?.to).toContain(ACTIVITY_STREAM_PUBLIC)
    })

    it('mints the status publicId from the backdated activity start time', async () => {
      const updatedFirst = await database.getFitnessFile({ id: firstFileId })
      const status = await database.getStatus({
        statusId: updatedFirst!.statusId!,
        withReplies: false
      })

      // The status URI tail is a v7 publicId minted from the (earliest,
      // backdated) activity start time, not `now` — so it sorts with the
      // activity rather than with the moment the import ran.
      expect(status?.publicId).toBeTruthy()
      expect(isPublicId(status?.publicId as string)).toBe(true)
      expect(status?.id).toBe(`${actor.id}/statuses/${status?.publicId}`)
      expect(getPublicIdTimestamp(status?.publicId as string)).toBe(
        firstActivity.startTime!.getTime()
      )
    })

    it('queues one process job for the primary file with notifyOnComplete false', async () => {
      const updatedFirst = await database.getFitnessFile({ id: firstFileId })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: expect.any(String),
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId: updatedFirst!.statusId,
          fitnessFileId: firstFileId,
          publishSendNote: false,
          // The default: this batch's publisher did not opt in, so the import
          // stays silent even though the status is brand new.
          notifyOnComplete: false
        }
      })
    })
  })

  it('keeps the post off the public timeline when the publisher omits visibility', async () => {
    const file = await createFitnessFile(
      'fit',
      'fitness/import-no-visibility.fit',
      'batch-no-visibility'
    )
    mockParseFitnessFile.mockResolvedValueOnce(routedActivity)

    await importFitnessFilesJob(database, {
      id: 'import-job-no-visibility',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-no-visibility',
        fitnessFileIds: [file!.id]
      }
    })

    const updated = await database.getFitnessFile({ id: file!.id })
    const status = await database.getStatus({
      statusId: updated!.statusId!,
      withReplies: false
    })
    expect(status).not.toBeNull()
    expect(status?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
    expect(status?.cc).not.toContain(ACTIVITY_STREAM_PUBLIC)
  })

  it('stamps the status at import time when the caller opts in', async () => {
    // The Strava webhook's case: the ride finished minutes ago and the post is
    // the news of it, so backdating to the start time would file it below
    // everything published while the ride was still going.
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-post-time.fit',
      fileName: 'import-post-time.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-post-time'
    })

    const activityStartTime = new Date('2026-01-01T00:00:00.000Z')
    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 5_000,
      totalDurationSeconds: 1_000,
      startTime: activityStartTime
    })

    // Pinned rather than asserted against a window between two real Date.now()
    // reads: a window only proves the stamp is not the activity start, and it
    // fails spuriously if the wall clock steps backwards mid-test. `toFake:
    // ['Date']` leaves timers real so the database round-trips still settle.
    const importedAt = Date.parse('2026-06-01T09:15:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(importedAt))
      await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'batch-post-time',
        fitnessFileIds: [file!.id],
        visibility: 'public',
        postAtImportTime: true
      })
    } finally {
      vi.useRealTimers()
    }

    const imported = await database.getFitnessFile({ id: file!.id })
    const status = await database.getStatus({
      statusId: imported!.statusId as string,
      withReplies: false
    })

    expect(status?.createdAt).toBe(importedAt)
    // The URI tail is minted from the same stamp, so the post sorts where it
    // reads rather than back at the activity.
    expect(getPublicIdTimestamp(status?.publicId as string)).toBe(importedAt)
    // The recorded start time is untouched — every fitness surface reads the
    // activity's date from the file, not from the post.
    expect(imported?.activityStartTime).toBe(activityStartTime.getTime())
  })

  it('keeps the existing post stamp when an opt-in import merges into it', async () => {
    // The second device's upload of the same ride. The sibling's post is
    // already published and may already have federated, so re-stamping it would
    // jump the ride back to the top of every follower's timeline.
    const firstFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/merge-post-time-a.fit',
      fileName: 'merge-post-time-a.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-merge-post-time'
    })
    const secondFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/merge-post-time-b.fit',
      fileName: 'merge-post-time-b.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-merge-post-time'
    })

    const activity: FitnessActivityData = {
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 5_000,
      totalDurationSeconds: 1_000,
      startTime: new Date('2026-03-02T06:00:00.000Z')
    }

    const firstImportedAt = Date.parse('2026-03-02T07:30:00.000Z')
    mockParseFitnessFile.mockResolvedValueOnce(activity)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(firstImportedAt))
      await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'batch-merge-post-time',
        fitnessFileIds: [firstFile!.id],
        visibility: 'public',
        postAtImportTime: true
      })

      // An hour later, the sibling arrives and merges into the same post.
      vi.setSystemTime(new Date(firstImportedAt + 60 * 60 * 1000))
      mockParseFitnessFile.mockResolvedValueOnce(activity)
      await importFitnessFiles(database, {
        actorId: actor.id,
        batchId: 'batch-merge-post-time',
        fitnessFileIds: [secondFile!.id],
        overlapFitnessFileIds: [firstFile!.id],
        visibility: 'public',
        postAtImportTime: true
      })
    } finally {
      vi.useRealTimers()
    }

    const mergedFirst = await database.getFitnessFile({ id: firstFile!.id })
    const mergedSecond = await database.getFitnessFile({ id: secondFile!.id })
    expect(mergedSecond?.statusId).toBe(mergedFirst?.statusId)

    const status = await database.getStatus({
      statusId: mergedFirst!.statusId as string,
      withReplies: false
    })
    expect(status?.createdAt).toBe(firstImportedAt)
  })

  it('reuses existing status when import job is retried', async () => {
    const firstFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/retry-overlap-a.fit',
      fileName: 'retry-overlap-a.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-retry-idempotent'
    })
    const secondFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/retry-overlap-b.fit',
      fileName: 'retry-overlap-b.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-retry-idempotent'
    })

    expect(firstFile).toBeDefined()
    expect(secondFile).toBeDefined()

    const firstActivity: FitnessActivityData = {
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 5_000,
      totalDurationSeconds: 1_000,
      startTime: new Date('2026-01-03T00:00:00.000Z')
    }
    const secondActivity: FitnessActivityData = {
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 4_500,
      totalDurationSeconds: 1_000,
      startTime: new Date('2026-01-03T00:03:20.000Z')
    }

    mockParseFitnessFile
      .mockResolvedValueOnce(firstActivity)
      .mockResolvedValueOnce(secondActivity)

    await importFitnessFilesJob(database, {
      id: 'import-job-retry-1',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-retry-idempotent',
        fitnessFileIds: [firstFile!.id, secondFile!.id],
        visibility: 'public'
      }
    })

    const afterFirstRun = await database.getFitnessFile({ id: firstFile!.id })
    const statusId = afterFirstRun?.statusId
    expect(statusId).toBeDefined()

    const publishMock = getQueue().publish as jest.Mock
    publishMock.mockClear()

    mockParseFitnessFile
      .mockResolvedValueOnce(firstActivity)
      .mockResolvedValueOnce(secondActivity)

    await importFitnessFilesJob(database, {
      id: 'import-job-retry-2',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-retry-idempotent',
        fitnessFileIds: [firstFile!.id, secondFile!.id],
        visibility: 'public'
      }
    })

    const firstAfterRetry = await database.getFitnessFile({ id: firstFile!.id })
    const secondAfterRetry = await database.getFitnessFile({
      id: secondFile!.id
    })

    expect(firstAfterRetry?.statusId).toBe(statusId)
    expect(secondAfterRetry?.statusId).toBe(statusId)
    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(publishMock).toHaveBeenCalledWith({
      id: expect.any(String),
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: actor.id,
        statusId,
        fitnessFileId: firstFile!.id,
        publishSendNote: false,
        notifyOnComplete: false
      }
    })
  })

  it('uses overlap context to attach retried files to an existing status', async () => {
    const existingFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/overlap-context-existing.fit',
      fileName: 'overlap-context-existing.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-overlap-context'
    })
    const retriedFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/overlap-context-retried.fit',
      fileName: 'overlap-context-retried.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-overlap-context'
    })

    expect(existingFile).toBeDefined()
    expect(retriedFile).toBeDefined()

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 5_000,
      totalDurationSeconds: 1_000,
      startTime: new Date('2026-01-06T00:00:00.000Z')
    })

    await importFitnessFilesJob(database, {
      id: 'import-job-overlap-context-initial',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-overlap-context',
        fitnessFileIds: [existingFile!.id],
        visibility: 'public'
      }
    })

    const existingAfterInitialImport = await database.getFitnessFile({
      id: existingFile!.id
    })
    const existingStatusId = existingAfterInitialImport?.statusId
    expect(existingStatusId).toBeDefined()

    await database.updateFitnessFileProcessingStatus(
      existingFile!.id,
      'completed'
    )

    const publishMock = getQueue().publish as jest.Mock
    publishMock.mockClear()

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 4_000,
      totalDurationSeconds: 900,
      startTime: new Date('2026-01-06T00:03:00.000Z')
    })

    await importFitnessFilesJob(database, {
      id: 'import-job-overlap-context-retry',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-overlap-context',
        fitnessFileIds: [retriedFile!.id],
        overlapFitnessFileIds: [existingFile!.id],
        visibility: 'public'
      }
    })

    const existingAfterRetry = await database.getFitnessFile({
      id: existingFile!.id
    })
    const retriedAfterRetry = await database.getFitnessFile({
      id: retriedFile!.id
    })

    expect(existingAfterRetry?.statusId).toBe(existingStatusId)
    expect(existingAfterRetry?.isPrimary).toBe(true)
    expect(existingAfterRetry?.processingStatus).toBe('completed')

    expect(retriedAfterRetry?.statusId).toBe(existingStatusId)
    expect(retriedAfterRetry?.isPrimary).toBe(false)
    expect(retriedAfterRetry?.importStatus).toBe('completed')
    expect(retriedAfterRetry?.processingStatus).toBe('completed')
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('deletes newly created status when import publish fails', async () => {
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-publish-fail.fit',
      fileName: 'import-publish-fail.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-publish-fail'
    })

    expect(file).toBeDefined()

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 3_000,
      totalDurationSeconds: 1_200,
      startTime: new Date('2026-01-04T00:00:00.000Z')
    })

    const publishMock = getQueue().publish as jest.Mock
    publishMock.mockRejectedValueOnce(new Error('queue unavailable'))

    await importFitnessFilesJob(database, {
      id: 'import-job-publish-fail',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-publish-fail',
        fitnessFileIds: [file!.id],
        visibility: 'public'
      }
    })

    const publishedJob = publishMock.mock.calls[0]?.[0] as
      { data: { statusId: string } } | undefined
    const createdStatusId = publishedJob?.data.statusId
    expect(createdStatusId).toBeDefined()

    const updated = await database.getFitnessFile({ id: file!.id })
    expect(updated?.statusId).toBeUndefined()
    expect(updated?.importStatus).toBe('failed')
    expect(updated?.processingStatus).toBe('failed')

    const status = await database.getStatus({
      statusId: createdStatusId!,
      withReplies: false
    })
    expect(status).toBeNull()
  })

  it('marks files as failed when actor is missing', async () => {
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-missing-actor.fit',
      fileName: 'import-missing-actor.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-missing-actor'
    })

    expect(file).toBeDefined()

    await importFitnessFilesJob(database, {
      id: 'import-job-missing-actor',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: `${actor.id}-missing`,
        batchId: 'batch-missing-actor',
        fitnessFileIds: [file!.id],
        visibility: 'public'
      }
    })

    const updated = await database.getFitnessFile({ id: file!.id })
    expect(updated?.importStatus).toBe('failed')
    expect(updated?.processingStatus).toBe('failed')
    expect(updated?.importError).toBe('Actor not found for fitness import')
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('marks missing target file ids as failed', async () => {
    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-existing.fit',
      fileName: 'import-existing.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-missing-file-id'
    })

    expect(file).toBeDefined()

    const missingFileId = 'fitness-file-missing-id'
    const importStatusSpy = vi.spyOn(database, 'updateFitnessFileImportStatus')
    const processingStatusSpy = vi.spyOn(
      database,
      'updateFitnessFileProcessingStatus'
    )

    mockParseFitnessFile.mockResolvedValueOnce({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 2_000,
      totalDurationSeconds: 900,
      startTime: new Date('2026-01-07T00:00:00.000Z')
    })

    await importFitnessFilesJob(database, {
      id: 'import-job-missing-file-id',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-missing-file-id',
        fitnessFileIds: [missingFileId, file!.id],
        visibility: 'public'
      }
    })

    expect(importStatusSpy).toHaveBeenCalledWith(
      missingFileId,
      'failed',
      'Fitness file missing during import'
    )
    // Both writes touch importError on the same row, so they must carry the same
    // reason — otherwise whichever lands last decides what the file says.
    expect(processingStatusSpy).toHaveBeenCalledWith(
      missingFileId,
      'failed',
      'Fitness file missing during import'
    )

    const updated = await database.getFitnessFile({ id: file!.id })
    expect(updated?.importStatus).toBe('completed')
    expect(updated?.statusId).toBeDefined()
  })

  it('marks parse failures and still processes valid files', async () => {
    const failedFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-fail.fit',
      fileName: 'import-fail.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-fail'
    })
    const successFile = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/import-success.fit',
      fileName: 'import-success.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024,
      importBatchId: 'batch-fail'
    })

    mockParseFitnessFile
      .mockRejectedValueOnce(new Error('invalid fit file'))
      .mockResolvedValueOnce({
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 2_000,
        totalDurationSeconds: 900,
        startTime: new Date('2026-01-02T00:00:00.000Z')
      })

    await importFitnessFilesJob(database, {
      id: 'import-job-2',
      name: IMPORT_FITNESS_FILES_JOB_NAME,
      data: {
        actorId: actor.id,
        batchId: 'batch-fail',
        fitnessFileIds: [failedFile!.id, successFile!.id],
        visibility: 'public'
      }
    })

    const failed = await database.getFitnessFile({ id: failedFile!.id })
    const success = await database.getFitnessFile({ id: successFile!.id })

    expect(failed?.importStatus).toBe('failed')
    expect(failed?.importError).toContain('invalid fit file')
    expect(failed?.statusId).toBeUndefined()

    expect(success?.importStatus).toBe('completed')
    expect(success?.statusId).toBeDefined()
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
  })

  describe('recording device', () => {
    it('resolves the device from the parsed file and links the activity', async () => {
      const file = await database.createFitnessFile({
        actorId: actor.id,
        path: 'fitness/device-link.fit',
        fileName: 'device-link.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024,
        importBatchId: 'batch-device-link'
      })

      mockParseFitnessFile.mockResolvedValue({
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 20_000,
        totalDurationSeconds: 3_600,
        startTime: new Date('2026-01-09T00:00:00.000Z'),
        deviceName: 'Hammerhead Karoo 3',
        deviceManufacturer: 'hammerhead'
      })

      await importFitnessFilesJob(database, {
        id: 'import-job-device-link',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-device-link',
          fitnessFileIds: [file!.id],
          visibility: 'public'
        }
      })

      const updated = await database.getFitnessFile({ id: file!.id })
      expect(updated?.deviceGearId).toBeDefined()

      const device = await database.getFitnessGear({
        id: updated?.deviceGearId as string,
        actorId: actor.id
      })
      expect(device).toMatchObject({
        kind: 'device',
        brand: 'Hammerhead',
        model: 'Karoo 3',
        deviceKey: 'name:hammerhead karoo 3'
      })

      await database.deleteFitnessGear({
        id: device!.id,
        actorId: actor.id
      })
    })

    it('links nothing when the parsed file names no device', async () => {
      const file = await database.createFitnessFile({
        actorId: actor.id,
        path: 'fitness/device-none.fit',
        fileName: 'device-none.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024,
        importBatchId: 'batch-device-none'
      })

      mockParseFitnessFile.mockResolvedValue({
        coordinates: [],
        trackPoints: [],
        totalDistanceMeters: 20_000,
        totalDurationSeconds: 3_600,
        startTime: new Date('2026-01-09T00:00:00.000Z')
      })

      await importFitnessFilesJob(database, {
        id: 'import-job-device-none',
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: actor.id,
          batchId: 'batch-device-none',
          fitnessFileIds: [file!.id],
          visibility: 'public'
        }
      })

      const updated = await database.getFitnessFile({ id: file!.id })
      expect(updated?.deviceGearId).toBeUndefined()
    })
  })
})

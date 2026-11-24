import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { updateNoteVisibilityFromUserInput } from '@/lib/actions/updateNoteVisibility'
import { getConfig } from '@/lib/config'
import type { DatabaseQueueConfig } from '@/lib/config/queue'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { getQueueJobById } from '@/lib/database/testing/fixtures'
import {
  DELETE_BLUESKY_CROSSPOST_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { DatabaseQueue } from '@/lib/services/queue/database'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR3_ID, seedActor3 } from '@/lib/stub/seed/actor3'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

enableFetchMocks()

const defaultQueue = vi.hoisted(() => ({
  publish: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn(() => defaultQueue)
}))

describe('Update note visibility action', () => {
  const { database, db, prepare } = createTestDatabase()
  const baseConfig = getConfig()
  let actor1: Actor | null | undefined
  let actor3: Actor | null | undefined

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    actor3 = await database.getActorFromUsername({
      username: seedActor3.username,
      domain: seedActor3.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    vi.mocked(getConfig).mockReturnValue(baseConfig)
    defaultQueue.publish.mockReset()
    defaultQueue.publish.mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReset()
    vi.mocked(getQueue).mockReturnValue(defaultQueue as never)
    vi.clearAllMocks()
  })

  describe('updateNoteVisibilityFromUserInput', () => {
    it('returns null when status does not exist', async () => {
      if (!actor1) fail('Actor1 is required')

      const result = await updateNoteVisibilityFromUserInput({
        statusId: `${ACTOR1_ID}/statuses/does-not-exist`,
        currentActor: actor1,
        visibility: 'public',
        database
      })

      expect(result).toBeNull()
    })

    it('returns null when status is not a Note type (Poll)', async () => {
      if (!actor3) fail('Actor3 is required')

      const result = await updateNoteVisibilityFromUserInput({
        statusId: `${ACTOR3_ID}/statuses/poll-1`,
        currentActor: actor3,
        visibility: 'public',
        database
      })

      expect(result).toBeNull()
    })

    it('returns null when status belongs to a different actor', async () => {
      if (!actor1) fail('Actor1 is required')

      // post-1 belongs to actor1, but we pass actor3 as the currentActor
      if (!actor3) fail('Actor3 is required')

      const result = await updateNoteVisibilityFromUserInput({
        statusId: `${ACTOR1_ID}/statuses/post-1`,
        currentActor: actor3,
        visibility: 'public',
        database
      })

      expect(result).toBeNull()
    })

    it('updates visibility to unlisted correctly', async () => {
      if (!actor1) fail('Actor1 is required')

      const result = await updateNoteVisibilityFromUserInput({
        statusId: `${ACTOR1_ID}/statuses/post-2`,
        currentActor: actor1,
        visibility: 'unlisted',
        database
      })

      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        actorId: actor1.id,
        to: [`${actor1.id}/followers`],
        cc: [ACTIVITY_STREAM_PUBLIC]
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(
          `${ACTOR1_ID}/statuses/post-2#update/${result?.updatedAt}`
        ),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: `${ACTOR1_ID}/statuses/post-2`
        }
      })
    })

    it('preserves mention recipients when changing visibility', async () => {
      if (!actor1) fail('Actor1 is required')

      const mentionedActorId = 'https://llun.test/@test2'
      const statusId = `${ACTOR1_ID}/statuses/post-with-mention`

      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`],
        text: '@test2 hello'
      })
      await database.createTag({
        statusId,
        name: '@test2',
        value: mentionedActorId,
        type: 'mention'
      })

      const result = await updateNoteVisibilityFromUserInput({
        statusId,
        currentActor: actor1,
        visibility: 'private',
        database
      })

      expect(result).not.toBeNull()
      // For private visibility, cc should contain mention hrefs
      expect(result?.cc).toContain(mentionedActorId)
    })

    it('drops a pending Bluesky cross-post when the post stops being public', async () => {
      if (!actor1) fail('Actor1 is required')

      const statusId = `${ACTOR1_ID}/statuses/crosspost-pending-narrow`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Public post'
      })
      await database.claimBlueskyCrosspost({
        statusId,
        actorId: actor1.id
      })

      const result = await updateNoteVisibilityFromUserInput({
        statusId,
        currentActor: actor1,
        visibility: 'private',
        database
      })

      expect(result).not.toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      // Nothing reached Bluesky, so nothing is deleted there.
      expect(getQueue().publish).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: DELETE_BLUESKY_CROSSPOST_JOB_NAME })
      )
    })

    it('drops a posting Bluesky cross-post when the post stops being public so in-flight createRecord cleans up', async () => {
      if (!actor1) fail('Actor1 is required')

      const statusId = `${ACTOR1_ID}/statuses/crosspost-posting-narrow`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Public post'
      })
      await database.claimBlueskyCrosspost({
        statusId,
        actorId: actor1.id
      })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })

      const result = await updateNoteVisibilityFromUserInput({
        statusId,
        currentActor: actor1,
        visibility: 'private',
        database
      })

      expect(result).not.toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      // No uri yet; when the in-flight createRecord finishes, markBlueskyCrosspostPosted
      // sees the row gone (returns false) and deletes the record directly.
      expect(
        await database.markBlueskyCrosspostPosted({
          statusId,
          attemptId: attemptId!,
          uri: 'at://did:plc:actor1/app.bsky.feed.post/3kinflight',
          cid: 'bafyinflight'
        })
      ).toBe(false)
      expect(getQueue().publish).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: DELETE_BLUESKY_CROSSPOST_JOB_NAME })
      )
    })

    it('deletes a posted Bluesky copy when the post stops being public', async () => {
      if (!actor1) fail('Actor1 is required')

      const statusId = `${ACTOR1_ID}/statuses/crosspost-posted-narrow`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Public post'
      })
      await database.claimBlueskyCrosspost({
        statusId,
        actorId: actor1.id
      })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      const uri = 'at://did:plc:actor1/app.bsky.feed.post/3knarrow'
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: attemptId!,
        uri,
        cid: 'bafynarrow'
      })

      const result = await updateNoteVisibilityFromUserInput({
        statusId,
        currentActor: actor1,
        visibility: 'unlisted',
        database
      })

      expect(result).not.toBeNull()
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(`${statusId}#bluesky-crosspost-delete`),
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        data: { actorId: actor1.id, uri }
      })
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
    })

    it('decides Bluesky deletion from the DELETE ... RETURNING row rather than a stale pre-read', async () => {
      if (!actor1) fail('Actor1 is required')

      const statusId = `${ACTOR1_ID}/statuses/crosspost-narrow-race`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Public post'
      })
      await database.claimBlueskyCrosspost({
        statusId,
        actorId: actor1.id
      })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      const uri = 'at://did:plc:actor1/app.bsky.feed.post/3kracenarrow'
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: attemptId!,
        uri,
        cid: 'bafyracenarrow'
      })

      // A stale pre-read via getBlueskyCrosspost would see 'posting' with no uri;
      // updateNoteVisibility must decide from deleteBlueskyCrosspost's returned row.
      const getSpy = vi
        .spyOn(database, 'getBlueskyCrosspost')
        .mockResolvedValue({
          statusId,
          actorId: actor1.id,
          uri: null,
          cid: null,
          state: 'posting',
          error: null,
          createdAt: 0,
          updatedAt: 0
        })
      try {
        const result = await updateNoteVisibilityFromUserInput({
          statusId,
          currentActor: actor1,
          visibility: 'private',
          database
        })
        expect(result).not.toBeNull()
        expect(getSpy).not.toHaveBeenCalled()
      } finally {
        getSpy.mockRestore()
      }

      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(`${statusId}#bluesky-crosspost-delete`),
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        data: { actorId: actor1.id, uri }
      })
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
    })

    it('publishes DELETE_BLUESKY_CROSSPOST_JOB_NAME before deleting the row on non-database queues, and keeps the row on publish failure for a later status delete', async () => {
      if (!actor1) fail('Actor1 is required')

      const statusId = `${ACTOR1_ID}/statuses/crosspost-posted-publish-fail`
      const uri = 'at://did:plc:actor1/app.bsky.feed.post/3kpubfail'
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Public post'
      })
      await database.claimBlueskyCrosspost({
        statusId,
        actorId: actor1.id
      })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: attemptId!,
        uri,
        cid: 'bafypubfail'
      })

      let rowDuringPublish: unknown = null
      defaultQueue.publish.mockImplementationOnce(async () => {
        rowDuringPublish = await database.getBlueskyCrosspost({ statusId })
        throw new Error('Queue unavailable')
      })
      const loggerSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => logger)

      try {
        const result = await updateNoteVisibilityFromUserInput({
          statusId,
          currentActor: actor1,
          visibility: 'private',
          database
        })
        expect(result).not.toBeNull()
        expect(rowDuringPublish).toMatchObject({
          statusId,
          state: 'posted',
          uri
        })
        expect(loggerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            statusId,
            actorId: actor1.id,
            err: expect.any(Error)
          }),
          'Failed to queue Bluesky cross-post delete'
        )
      } finally {
        loggerSpy.mockRestore()
      }

      // Publish failed, so the posted row remains in place.
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        statusId,
        state: 'posted',
        uri
      })

      // A later deletion of the status still sees the row and queues the
      // Bluesky delete job.
      defaultQueue.publish.mockClear()
      await deleteStatusFromUserInput({
        currentActor: actor1,
        statusId,
        database
      })
      expect(defaultQueue.publish).toHaveBeenCalledWith({
        id: getHashFromString(`${statusId}#bluesky-crosspost-delete`),
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        data: { actorId: actor1.id, uri }
      })
    })

    it('deletes the cross-post row and inserts DELETE_BLUESKY_CROSSPOST_JOB_NAME atomically on the database queue', async () => {
      if (!actor1) fail('Actor1 is required')

      const queueConfig: DatabaseQueueConfig = {
        type: 'database',
        maxRetries: 7
      }
      vi.mocked(getConfig).mockReturnValue({
        ...baseConfig,
        queue: queueConfig
      })
      const dbQueue = new DatabaseQueue(queueConfig, database)
      const publishSpy = vi.spyOn(dbQueue, 'publish')
      vi.mocked(getQueue).mockReturnValue(dbQueue)

      const statusId = `${ACTOR1_ID}/statuses/crosspost-dbqueue-narrow`
      const uri = 'at://did:plc:actor1/app.bsky.feed.post/3kdbqueue'
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Public post on database queue'
      })
      await database.claimBlueskyCrosspost({
        statusId,
        actorId: actor1.id
      })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: attemptId!,
        uri,
        cid: 'bafydbqueue'
      })

      const result = await updateNoteVisibilityFromUserInput({
        statusId,
        currentActor: actor1,
        visibility: 'unlisted',
        database
      })

      expect(result).not.toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()

      const expectedJobId = getHashFromString(
        `${statusId}#bluesky-crosspost-delete`
      )
      expect(await getQueueJobById(db, expectedJobId)).toMatchObject({
        id: expectedJobId,
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        payload: {
          id: expectedJobId,
          name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
          data: { actorId: actor1.id, uri }
        },
        attempts: 0,
        maxRetries: 7,
        status: 'pending'
      })
      // Inserted in the outbox transaction, never via queue.publish.
      expect(publishSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: DELETE_BLUESKY_CROSSPOST_JOB_NAME })
      )
    })

    it('rolls back the cross-post delete on the database queue when inserting the delete job fails, and drops non-posted rows without a job', async () => {
      if (!actor1) fail('Actor1 is required')

      const queueConfig: DatabaseQueueConfig = {
        type: 'database',
        maxRetries: 16
      }
      vi.mocked(getConfig).mockReturnValue({
        ...baseConfig,
        queue: queueConfig
      })
      const dbQueue = new DatabaseQueue(queueConfig, database)
      vi.mocked(getQueue).mockReturnValue(dbQueue)

      const statusId = `${ACTOR1_ID}/statuses/crosspost-dbqueue-rollback`
      const uri = 'at://did:plc:actor1/app.bsky.feed.post/3kdbrollback'
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Public post rollback'
      })
      await database.claimBlueskyCrosspost({
        statusId,
        actorId: actor1.id
      })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: attemptId!,
        uri,
        cid: 'bafydbrollback'
      })

      // Pre-occupy the deterministic job id with another job name so
      // createQueueJob throws inside the transaction.
      const conflictingJobId = getHashFromString(
        `${statusId}#bluesky-crosspost-delete`
      )
      await database.createQueueJob({
        id: conflictingJobId,
        name: 'otherJob',
        payload: { id: conflictingJobId, name: 'otherJob', data: {} },
        attempts: 0,
        maxRetries: 3,
        nextRunAt: new Date(),
        status: 'pending'
      })

      const loggerSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => logger)
      try {
        const result = await updateNoteVisibilityFromUserInput({
          statusId,
          currentActor: actor1,
          visibility: 'private',
          database
        })
        expect(result).not.toBeNull()
        expect(loggerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            statusId,
            actorId: actor1.id,
            err: expect.any(Error)
          }),
          'Failed to remove the Bluesky cross-post of a narrowed post'
        )
      } finally {
        loggerSpy.mockRestore()
      }

      // Transaction rolled back: posted row is still intact.
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        statusId,
        state: 'posted',
        uri
      })

      // Pending row on database queue: deleted with no queue job.
      const pendingStatusId = `${ACTOR1_ID}/statuses/crosspost-dbqueue-pending`
      await database.createNote({
        id: pendingStatusId,
        url: pendingStatusId,
        actorId: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Pending post on database queue'
      })
      await database.claimBlueskyCrosspost({
        statusId: pendingStatusId,
        actorId: actor1.id
      })
      await updateNoteVisibilityFromUserInput({
        statusId: pendingStatusId,
        currentActor: actor1,
        visibility: 'private',
        database
      })
      expect(
        await database.getBlueskyCrosspost({ statusId: pendingStatusId })
      ).toBeNull()
      expect(
        await getQueueJobById(
          db,
          getHashFromString(`${pendingStatusId}#bluesky-crosspost-delete`)
        )
      ).toBeNull()
    })
  })
})

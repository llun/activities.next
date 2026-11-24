import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { Config } from '@/lib/config'
import {
  CloudTasksConfig,
  DatabaseQueueConfig,
  QStashConfig,
  QueueConfig
} from '@/lib/config/queue'
import { type Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { getQueueJobById } from '@/lib/database/testing/fixtures'
import { Database } from '@/lib/database/types'
import {
  DELETE_BLUESKY_CROSSPOST_JOB_NAME,
  SEND_DELETE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { BLUESKY_CROSSPOST_COLLISION_MESSAGE } from '@/lib/services/bluesky/crosspost'
import { deterministicTid } from '@/lib/services/bluesky/tid'
import { getQueue } from '@/lib/services/queue'
import { CloudTasksQueue } from '@/lib/services/queue/cloudtasks'
import { DatabaseQueue } from '@/lib/services/queue/database'
import { NoQueue } from '@/lib/services/queue/noqueue'
import { QStashQueue } from '@/lib/services/queue/qstash'
import { storeBlueskyPost } from '@/lib/stub/blueskyPost'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

let currentMockConfig: { queue?: QueueConfig } = { queue: undefined }

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => currentMockConfig as Config)
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

const CURRENT_ACTOR = { id: 'https://llun.test/users/me' } as Actor

const createMockStatus = (overrides: Partial<StatusNote> = {}): StatusNote => ({
  id: 'https://llun.test/users/me/statuses/1',
  url: 'https://llun.test/users/me/statuses/1',
  actorId: CURRENT_ACTOR.id,
  actor: null,
  type: StatusType.enum.Note,
  text: 'Hello',
  summary: null,
  reply: '',
  replies: [],
  totalReplies: 0,
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [],
  edits: [],
  attachments: [],
  tags: [],
  isLocalActor: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides
})

const createDatabase = (status: Status | null) =>
  ({
    getStatus: vi.fn().mockResolvedValue(status),
    getBlueskyAccount: vi.fn().mockResolvedValue(null),
    getBlueskyCrosspost: vi.fn().mockResolvedValue(null),
    deleteBlueskyCrosspost: vi.fn().mockResolvedValue(null),
    deleteStatus: vi
      .fn()
      .mockResolvedValue({ deleted: true, blueskyCrossposts: [] }),
    deleteStatusWithQueueJob: vi
      .fn()
      .mockResolvedValue({ deleted: true, blueskyCrossposts: [] })
  }) as unknown as Database

describe('deleteStatusFromUserInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentMockConfig = { queue: undefined }
  })

  describe('Database queue backend', () => {
    beforeEach(() => {
      const queueConfig: DatabaseQueueConfig = {
        type: 'database',
        maxRetries: 16
      }
      currentMockConfig = { queue: queueConfig }
      const dbQueue = new DatabaseQueue(queueConfig)
      vi.spyOn(dbQueue, 'publish')
      vi.mocked(getQueue).mockReturnValue(dbQueue)
    })

    it('atomically deletes status and enqueues deletion job via deleteStatusWithQueueJob', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/db-delete-1',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: ['https://llun.test/users/me/followers']
      })
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      const expectedJobId = getHashFromString(`${status.id}#delete`)
      expect(database.deleteStatusWithQueueJob).toHaveBeenCalledTimes(1)
      expect(database.deleteStatusWithQueueJob).toHaveBeenCalledWith({
        actorId: CURRENT_ACTOR.id,
        statusId: status.id,
        queueJob: {
          id: expectedJobId,
          name: SEND_DELETE_NOTE_JOB_NAME,
          payload: {
            id: expectedJobId,
            name: SEND_DELETE_NOTE_JOB_NAME,
            data: {
              actorId: CURRENT_ACTOR.id,
              statusId: status.id,
              to: status.to,
              cc: status.cc
            }
          },
          attempts: 0,
          maxRetries: 16,
          nextRunAt: expect.any(Date),
          status: 'pending'
        },
        buildAdditionalQueueJobs: expect.any(Function)
      })

      // Must not separately delete, take cross-post pre-delete, or publish
      expect(database.deleteBlueskyCrosspost).not.toHaveBeenCalled()
      expect(database.deleteStatus).not.toHaveBeenCalled()
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('builds DELETE_BLUESKY_CROSSPOST_JOB_NAME inside deleteStatusWithQueueJob for posted rows, and for non-posted rows only when a Bluesky account is linked', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/db-crosspost-builder',
        actorId: CURRENT_ACTOR.id,
        createdAt: 1_730_000_000_000
      })
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      const callArgs = vi.mocked(database.deleteStatusWithQueueJob).mock
        .calls[0][0]
      const buildAdditionalQueueJobs = callArgs.buildAdditionalQueueJobs
      expect(buildAdditionalQueueJobs).toBeTypeOf('function')

      const uri =
        'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3kdbbuilder'
      const unlinkedJobs = buildAdditionalQueueJobs!({
        deleted: true,
        blueskyCrossposts: [
          {
            statusId: status.id,
            actorId: CURRENT_ACTOR.id,
            uri,
            cid: 'bafy',
            state: 'posted',
            error: null,
            createdAt: 0,
            updatedAt: 0
          },
          {
            statusId: `${status.id}/reply-posting`,
            actorId: CURRENT_ACTOR.id,
            uri: null,
            cid: null,
            state: 'posting',
            error: null,
            createdAt: 0,
            updatedAt: 0,
            statusCreatedAt: 1_730_000_001_000
          },
          {
            statusId: `${status.id}/reply-pending`,
            actorId: CURRENT_ACTOR.id,
            uri: null,
            cid: null,
            state: 'pending',
            error: null,
            createdAt: 0,
            updatedAt: 0,
            statusCreatedAt: 1_730_000_002_000
          },
          {
            statusId: `${status.id}/reply-failed`,
            actorId: CURRENT_ACTOR.id,
            uri: null,
            cid: null,
            state: 'failed',
            error: 'err',
            createdAt: 0,
            updatedAt: 0,
            statusCreatedAt: 1_730_000_003_000
          }
        ]
      })

      const expectedCrosspostJobId = getHashFromString(
        `${status.id}#bluesky-crosspost-delete`
      )
      expect(unlinkedJobs).toEqual([
        {
          id: expectedCrosspostJobId,
          name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
          payload: {
            id: expectedCrosspostJobId,
            name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
            data: { actorId: CURRENT_ACTOR.id, uri }
          },
          attempts: 0,
          maxRetries: 16,
          nextRunAt: expect.any(Date),
          status: 'pending'
        }
      ])

      // With a linked Bluesky account, pending/posting/failed rows also build
      // delete jobs using their deterministic record URIs.
      const linkedDid = `did:plc:${'a'.repeat(24)}`
      const linkedDb = createDatabase(status)
      vi.mocked(linkedDb.getBlueskyAccount).mockResolvedValue({
        did: linkedDid
      } as never)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database: linkedDb
      })

      const linkedBuilder = vi.mocked(linkedDb.deleteStatusWithQueueJob).mock
        .calls[0][0].buildAdditionalQueueJobs!
      const linkedJobs = linkedBuilder({
        deleted: true,
        blueskyCrossposts: [
          {
            statusId: status.id,
            actorId: CURRENT_ACTOR.id,
            uri: null,
            cid: null,
            state: 'failed',
            error: 'err',
            createdAt: 0,
            updatedAt: 0
          }
        ]
      })
      const expectedDeterministicUri = `at://${linkedDid}/app.bsky.feed.post/${deterministicTid(status.createdAt, status.id)}`
      expect(linkedJobs).toEqual([
        {
          id: expectedCrosspostJobId,
          name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
          payload: {
            id: expectedCrosspostJobId,
            name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
            data: {
              actorId: CURRENT_ACTOR.id,
              uri: expectedDeterministicUri,
              expectedCreatedAt: new Date(status.createdAt).toISOString()
            }
          },
          attempts: 0,
          maxRetries: 16,
          nextRunAt: expect.any(Date),
          status: 'pending'
        }
      ])

      // A failed row with the collision message must never queue a deterministic delete.
      expect(
        linkedBuilder({
          deleted: true,
          blueskyCrossposts: [
            {
              statusId: status.id,
              actorId: CURRENT_ACTOR.id,
              uri: null,
              cid: null,
              state: 'failed',
              error: BLUESKY_CROSSPOST_COLLISION_MESSAGE,
              createdAt: 0,
              updatedAt: 0
            }
          ]
        })
      ).toEqual([])
    })

    it('respects custom maxRetries from DatabaseQueueConfig', async () => {
      const queueConfig: DatabaseQueueConfig = {
        type: 'database',
        maxRetries: 5
      }
      currentMockConfig = { queue: queueConfig }
      const dbQueue = new DatabaseQueue(queueConfig)
      vi.mocked(getQueue).mockReturnValue(dbQueue)

      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/db-custom-retries',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      expect(database.deleteStatusWithQueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          queueJob: expect.objectContaining({
            maxRetries: 5
          })
        })
      )
    })

    it('snapshots recipient addresses (to, cc) in the job payload', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/snapshot-test',
        actorId: CURRENT_ACTOR.id,
        to: ['https://remote.example/users/alice', ACTIVITY_STREAM_PUBLIC],
        cc: ['https://remote.example/users/bob']
      })
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      const callArgs = vi.mocked(database.deleteStatusWithQueueJob).mock
        .calls[0][0]
      expect(callArgs.queueJob.payload).toEqual({
        id: getHashFromString(`${status.id}#delete`),
        name: SEND_DELETE_NOTE_JOB_NAME,
        data: {
          actorId: CURRENT_ACTOR.id,
          statusId: status.id,
          to: ['https://remote.example/users/alice', ACTIVITY_STREAM_PUBLIC],
          cc: ['https://remote.example/users/bob']
        }
      })
    })

    it('propagates transaction failure when deleteStatusWithQueueJob rejects', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/db-tx-fail',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const database = createDatabase(status)
      const txError = new Error('Database transaction rolled back')
      vi.mocked(database.deleteStatusWithQueueJob).mockRejectedValueOnce(
        txError
      )

      await expect(
        deleteStatusFromUserInput({
          currentActor: CURRENT_ACTOR,
          statusId: status.id,
          database
        })
      ).rejects.toThrow('Database transaction rolled back')
    })

    it('handles repeated deletion gracefully when status is already deleted', async () => {
      const database = createDatabase(null)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: 'https://llun.test/users/me/statuses/already-deleted',
        database
      })

      expect(database.deleteStatusWithQueueJob).not.toHaveBeenCalled()
      expect(database.deleteStatus).not.toHaveBeenCalled()
    })

    it('handles repeated deletion gracefully when deleteStatusWithQueueJob returns deleted: false', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/race-condition',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const database = createDatabase(status)
      vi.mocked(database.deleteStatusWithQueueJob).mockResolvedValueOnce({
        deleted: false,
        blueskyCrossposts: []
      })

      await expect(
        deleteStatusFromUserInput({
          currentActor: CURRENT_ACTOR,
          statusId: status.id,
          database
        })
      ).resolves.toBeUndefined()
    })
  })

  describe('QStash queue backend', () => {
    let qstashQueue: QStashQueue

    beforeEach(() => {
      const queueConfig: QStashConfig = {
        type: 'qstash',
        url: 'https://qstash.example.com',
        token: 'token',
        currentSigningKey: 'sig1',
        nextSigningKey: 'sig2'
      }
      currentMockConfig = { queue: queueConfig }
      qstashQueue = new QStashQueue(queueConfig)
      vi.spyOn(qstashQueue, 'publish').mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(qstashQueue)
    })

    it('deletes locally before publishing to QStash', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/qstash-delete',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: ['https://remote.example/users/bob']
      })
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      expect(database.deleteStatus).toHaveBeenCalledWith({
        statusId: status.id,
        actorId: CURRENT_ACTOR.id
      })
      expect(database.deleteStatusWithQueueJob).not.toHaveBeenCalled()

      expect(qstashQueue.publish).toHaveBeenCalledWith({
        id: getHashFromString(`${status.id}#delete`),
        name: SEND_DELETE_NOTE_JOB_NAME,
        data: {
          actorId: CURRENT_ACTOR.id,
          statusId: status.id,
          to: status.to,
          cc: status.cc
        }
      })

      const deleteOrder = vi.mocked(database.deleteStatus).mock
        .invocationCallOrder[0]
      const publishOrder = vi.mocked(qstashQueue.publish).mock
        .invocationCallOrder[0]
      expect(deleteOrder).toBeLessThan(publishOrder)
    })

    it('swallows and logs QStash enqueue error without failing the deletion', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/qstash-fail',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const database = createDatabase(status)
      vi.spyOn(qstashQueue, 'publish').mockRejectedValueOnce(
        new Error('QStash network error')
      )
      const loggerSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => logger)

      try {
        await expect(
          deleteStatusFromUserInput({
            currentActor: CURRENT_ACTOR,
            statusId: status.id,
            database
          })
        ).resolves.toBeUndefined()

        expect(database.deleteStatus).toHaveBeenCalledTimes(1)
        expect(loggerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            statusId: status.id,
            actorId: CURRENT_ACTOR.id
          }),
          'Failed to queue status delete federation'
        )
      } finally {
        loggerSpy.mockRestore()
      }
    })
  })

  describe.each([
    {
      name: 'database',
      setup: () => {
        const queueConfig: DatabaseQueueConfig = {
          type: 'database',
          maxRetries: 16
        }
        currentMockConfig = { queue: queueConfig }
        return new DatabaseQueue(queueConfig)
      }
    },
    {
      name: 'QStash',
      setup: () => {
        const queueConfig: QStashConfig = {
          type: 'qstash',
          url: 'https://qstash.example.com',
          token: 'token',
          currentSigningKey: 'sig1',
          nextSigningKey: 'sig2'
        }
        currentMockConfig = { queue: queueConfig }
        return new QStashQueue(queueConfig)
      }
    }
  ])('ownership check on the $name queue backend', ({ setup }) => {
    it('rejects deletion when status is owned by another actor', async () => {
      const queue = setup()
      vi.spyOn(queue, 'publish').mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(queue)
      const status = createMockStatus({
        id: 'https://llun.test/users/other/statuses/unauthorized',
        actorId: 'https://llun.test/users/other',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      expect(database.deleteStatusWithQueueJob).not.toHaveBeenCalled()
      expect(database.deleteStatus).not.toHaveBeenCalled()
      expect(queue.publish).not.toHaveBeenCalled()
    })
  })

  describe('CloudTasks queue backend', () => {
    let cloudTasksQueue: CloudTasksQueue

    beforeEach(() => {
      const queueConfig: CloudTasksConfig = {
        type: 'cloudtasks',
        location: 'us-central1',
        project: 'test-project'
      }
      currentMockConfig = { queue: queueConfig }
      cloudTasksQueue = new CloudTasksQueue(queueConfig)
      vi.spyOn(cloudTasksQueue, 'publish').mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(cloudTasksQueue)
    })

    it('deletes locally before publishing to CloudTasks', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/cloudtasks-delete',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      expect(database.deleteStatus).toHaveBeenCalledWith({
        statusId: status.id,
        actorId: CURRENT_ACTOR.id
      })
      expect(cloudTasksQueue.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          id: getHashFromString(`${status.id}#delete`),
          name: SEND_DELETE_NOTE_JOB_NAME
        })
      )
    })

    it('swallows and logs CloudTasks publish failure', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/cloudtasks-fail',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const database = createDatabase(status)
      vi.spyOn(cloudTasksQueue, 'publish').mockRejectedValueOnce(
        new Error('CloudTasks quota exceeded')
      )
      const loggerSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => logger)

      try {
        await expect(
          deleteStatusFromUserInput({
            currentActor: CURRENT_ACTOR,
            statusId: status.id,
            database
          })
        ).resolves.toBeUndefined()

        expect(loggerSpy).toHaveBeenCalled()
      } finally {
        loggerSpy.mockRestore()
      }
    })
  })

  describe('Inline / NoQueue backend', () => {
    let noQueue: NoQueue

    beforeEach(() => {
      currentMockConfig = { queue: undefined }
      noQueue = new NoQueue()
      vi.spyOn(noQueue, 'publish').mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(noQueue)
    })

    it('deletes locally before publishing to inline queue', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/inline-delete',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      expect(database.deleteStatus).toHaveBeenCalledWith({
        statusId: status.id,
        actorId: CURRENT_ACTOR.id
      })
      expect(noQueue.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          id: getHashFromString(`${status.id}#delete`),
          name: SEND_DELETE_NOTE_JOB_NAME
        })
      )
    })

    it('swallows inline publish failure after local deletion committed', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/inline-fail',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const database = createDatabase(status)
      vi.spyOn(noQueue, 'publish').mockRejectedValueOnce(
        new Error('Inline handler failure')
      )

      await expect(
        deleteStatusFromUserInput({
          currentActor: CURRENT_ACTOR,
          statusId: status.id,
          database
        })
      ).resolves.toBeUndefined()

      expect(database.deleteStatus).toHaveBeenCalledTimes(1)
    })

    it('propagates error when local database.deleteStatus fails', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/local-db-fail',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const database = createDatabase(status)
      vi.mocked(database.deleteStatus).mockRejectedValueOnce(
        new Error('Disk I/O error')
      )

      await expect(
        deleteStatusFromUserInput({
          currentActor: CURRENT_ACTOR,
          statusId: status.id,
          database
        })
      ).rejects.toThrow('Disk I/O error')

      expect(noQueue.publish).not.toHaveBeenCalled()
    })

    it('queues DELETE_BLUESKY_CROSSPOST_JOB_NAME from the cross-post row returned by deleteStatus after commit', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/crossposted',
        actorId: CURRENT_ACTOR.id
      })
      const database = createDatabase(status)
      const uri = 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3k1'
      let deleteStatusResolved = false
      vi.mocked(database.deleteStatus).mockImplementation(async () => {
        await Promise.resolve()
        deleteStatusResolved = true
        return {
          deleted: true,
          blueskyCrossposts: [
            {
              statusId: status.id,
              actorId: CURRENT_ACTOR.id,
              uri,
              cid: 'bafy',
              state: 'posted',
              error: null,
              createdAt: 0,
              updatedAt: 0
            }
          ]
        }
      })
      // Record whether the local delete had already resolved when each publish
      // ran, so a publish reordered ahead of it cannot slip through.
      const publishSawResolvedDelete: boolean[] = []
      vi.mocked(noQueue.publish).mockImplementation(async () => {
        publishSawResolvedDelete.push(deleteStatusResolved)
      })

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      expect(database.getBlueskyCrosspost).not.toHaveBeenCalled()
      expect(database.deleteBlueskyCrosspost).not.toHaveBeenCalled()
      expect(noQueue.publish).toHaveBeenCalledWith({
        id: getHashFromString(`${status.id}#bluesky-crosspost-delete`),
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        data: { actorId: CURRENT_ACTOR.id, uri }
      })
      // Both the delete-note job and the Bluesky delete must be published only
      // after deleteStatus resolved, whatever order they are published in.
      expect(publishSawResolvedDelete).toEqual([true, true])
      expect(
        vi
          .mocked(noQueue.publish)
          .mock.calls.some(
            ([message]) => message.name === DELETE_BLUESKY_CROSSPOST_JOB_NAME
          )
      ).toBe(true)
    })

    it('swallows and logs a failed Bluesky cross-post delete publish after local delete committed', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/crosspost-publish-fail',
        actorId: CURRENT_ACTOR.id
      })
      const database = createDatabase(status)
      const uri =
        'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3kfail'
      vi.mocked(database.deleteStatus).mockResolvedValue({
        deleted: true,
        blueskyCrossposts: [
          {
            statusId: status.id,
            actorId: CURRENT_ACTOR.id,
            uri,
            cid: 'bafyfail',
            state: 'posted',
            error: null,
            createdAt: 0,
            updatedAt: 0
          }
        ]
      })
      vi.spyOn(noQueue, 'publish')
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Queue unreachable'))
      const loggerSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => logger)

      try {
        await expect(
          deleteStatusFromUserInput({
            currentActor: CURRENT_ACTOR,
            statusId: status.id,
            database
          })
        ).resolves.toBeUndefined()

        expect(loggerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            statusId: status.id,
            actorId: CURRENT_ACTOR.id
          }),
          'Failed to queue Bluesky cross-post delete'
        )
      } finally {
        loggerSpy.mockRestore()
      }
    })

    it('queues no Bluesky delete when deleteStatus returns no cross-post rows', async () => {
      const status = createMockStatus({
        id: 'https://llun.test/users/me/statuses/not-crossposted',
        actorId: CURRENT_ACTOR.id
      })
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      expect(database.deleteBlueskyCrosspost).not.toHaveBeenCalled()
      expect(database.deleteStatus).toHaveBeenCalledTimes(1)
      expect(noQueue.publish).toHaveBeenCalledTimes(1)
      expect(noQueue.publish).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: DELETE_BLUESKY_CROSSPOST_JOB_NAME })
      )
    })

    it('queues no Bluesky delete for a pending, posting or failed row when no Bluesky account is linked', async () => {
      for (const state of ['pending', 'posting', 'failed'] as const) {
        const status = createMockStatus({
          id: `https://llun.test/users/me/statuses/${state}-crosspost`,
          actorId: CURRENT_ACTOR.id
        })
        const database = createDatabase(status)
        vi.mocked(database.deleteStatus).mockResolvedValue({
          deleted: true,
          blueskyCrossposts: [
            {
              statusId: status.id,
              actorId: CURRENT_ACTOR.id,
              uri: null,
              cid: null,
              state,
              error:
                state === 'failed' ? 'Bluesky did not accept the post.' : null,
              createdAt: 0,
              updatedAt: 0
            }
          ]
        })

        await deleteStatusFromUserInput({
          currentActor: CURRENT_ACTOR,
          statusId: status.id,
          database
        })

        expect(database.deleteBlueskyCrosspost).not.toHaveBeenCalled()
        expect(database.deleteStatus).toHaveBeenCalledTimes(1)
        expect(noQueue.publish).not.toHaveBeenCalledWith(
          expect.objectContaining({ name: DELETE_BLUESKY_CROSSPOST_JOB_NAME })
        )
      }
    })
  })

  describe('Immediate local disappearance (Integration with SQL Database)', () => {
    let database: Database
    let db: Db
    let actor: Actor

    beforeEach(async () => {
      const testDb = createTestDatabase()
      database = testDb.database
      db = testDb.db
      await testDb.prepare()
      await database.migrate()
      const queueConfig: DatabaseQueueConfig = {
        type: 'database',
        maxRetries: 16
      }
      currentMockConfig = { queue: queueConfig }
      const dbQueue = new DatabaseQueue(queueConfig, database)
      vi.mocked(getQueue).mockReturnValue(dbQueue)

      await database.createAccount({
        email: 'integration-author@test.local',
        username: 'integration_author',
        passwordHash: 'hash',
        domain: 'test.local',
        privateKey: 'key',
        publicKey: 'pub'
      })
      const found = await database.getActorFromEmail({
        email: 'integration-author@test.local'
      })
      if (!found) throw new Error('Actor creation failed')
      actor = found
    })

    afterEach(async () => {
      await database.destroy()
    })

    // A parent note and a same-actor reply, both with a posted cross-post row,
    // so deleting the parent must queue a Bluesky delete for both uris.
    const createCrosspostedReplyTree = async () => {
      const parentStatusId = `${actor.id}/statuses/integration-crosspost-tree-parent`
      const replyStatusId = `${actor.id}/statuses/integration-crosspost-tree-reply`
      const parentUri =
        'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3ktreeparent'
      const replyUri =
        'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3ktreereply'

      await database.createNote({
        id: parentStatusId,
        url: parentStatusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Cross-posted parent'
      })
      await database.createNote({
        id: replyStatusId,
        url: replyStatusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Cross-posted reply',
        reply: parentStatusId
      })
      for (const [statusId, uri] of [
        [parentStatusId, parentUri],
        [replyStatusId, replyUri]
      ] as const) {
        await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })
        const attemptId = await database.beginBlueskyCrosspostAttempt({
          statusId
        })
        await database.markBlueskyCrosspostPosted({
          statusId,
          attemptId: attemptId!,
          uri,
          cid: `bafy-${statusId.slice(-6)}`
        })
      }

      return { parentStatusId, replyStatusId, parentUri, replyUri }
    }

    it('immediately deletes status and persists pending queue job in the database', async () => {
      const statusId = `${actor.id}/statuses/integration-delete-test`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor.id}/followers`],
        text: 'Integration status deletion test note'
      })

      // Verify status exists before
      const beforeStatus = await database.getStatus({ statusId })
      expect(beforeStatus).not.toBeNull()

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId,
        database
      })

      // Status must disappear immediately
      const afterStatus = await database.getStatus({ statusId })
      expect(afterStatus).toBeNull()

      // Queue job must exist in database in pending status
      const expectedJobId = getHashFromString(`${statusId}#delete`)
      const persistedJob = await getQueueJobById(db, expectedJobId)
      expect(persistedJob).not.toBeNull()
      expect(persistedJob?.name).toBe(SEND_DELETE_NOTE_JOB_NAME)
      expect(persistedJob?.status).toBe('pending')
      expect(persistedJob?.attempts).toBe(0)
      expect(persistedJob?.payload).toMatchObject({
        id: expectedJobId,
        name: SEND_DELETE_NOTE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${actor.id}/followers`]
        }
      })
    })

    it('rolls back status deletion and leaves no queue job when transaction fails midway', async () => {
      const statusId = `${actor.id}/statuses/integration-rollback-test`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor.id}/followers`],
        text: 'Integration rollback test note'
      })

      const expectedJobId = getHashFromString(`${statusId}#delete`)
      vi.spyOn(database, 'deleteStatusWithQueueJob').mockImplementationOnce(
        async () => {
          throw new Error('Forced transaction failure')
        }
      )

      await expect(
        deleteStatusFromUserInput({
          currentActor: actor,
          statusId,
          database
        })
      ).rejects.toThrow('Forced transaction failure')

      // Status still exists because transaction rolled back
      const afterStatus = await database.getStatus({ statusId })
      expect(afterStatus).not.toBeNull()

      // Queue job was not persisted
      const persistedJob = await getQueueJobById(db, expectedJobId)
      expect(persistedJob).toBeNull()
    })

    it('refuses to delete or federate a Delete for a Bluesky post or a local boost of one', async () => {
      const { statusId: blueskyPostId } = await storeBlueskyPost(
        database,
        'deleteaction'
      )
      const announceId = `${actor.id}/statuses/local-bsky-boost`
      await database.createAnnounce({
        id: announceId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: blueskyPostId
      })

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId: announceId,
        database
      })
      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId: blueskyPostId,
        database
      })

      expect(await database.getStatus({ statusId: announceId })).not.toBeNull()
      expect(
        await database.getStatus({ statusId: blueskyPostId })
      ).not.toBeNull()
      expect(
        await getQueueJobById(db, getHashFromString(`${announceId}#delete`))
      ).toBeNull()
      expect(
        await getQueueJobById(db, getHashFromString(`${blueskyPostId}#delete`))
      ).toBeNull()
    })

    it('atomically takes the cross-post row inside deleteStatusWithQueueJob and queues Bluesky delete when row turns posted right before delete', async () => {
      const statusId = `${actor.id}/statuses/integration-crosspost-race`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Cross-posted note'
      })
      await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      const uri =
        'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3kdbq'

      // Simulate the row turning 'posted' right before deleteStatusWithQueueJob
      // runs (after a stale getBlueskyCrosspost read would have observed 'posting').
      const originalDeleteWithQueueJob =
        database.deleteStatusWithQueueJob.bind(database)
      const getCrosspostSpy = vi.spyOn(database, 'getBlueskyCrosspost')
      const deleteCrosspostSpy = vi.spyOn(database, 'deleteBlueskyCrosspost')
      const deleteWithQueueJobSpy = vi
        .spyOn(database, 'deleteStatusWithQueueJob')
        .mockImplementationOnce(async (params) => {
          await database.markBlueskyCrosspostPosted({
            statusId,
            attemptId: attemptId!,
            uri,
            cid: 'bafydbq'
          })
          return originalDeleteWithQueueJob(params)
        })
      try {
        await deleteStatusFromUserInput({
          currentActor: actor,
          statusId,
          database
        })
        expect(getCrosspostSpy).not.toHaveBeenCalled()
        expect(deleteCrosspostSpy).not.toHaveBeenCalled()
      } finally {
        getCrosspostSpy.mockRestore()
        deleteCrosspostSpy.mockRestore()
        deleteWithQueueJobSpy.mockRestore()
      }

      expect(await database.getStatus({ statusId })).toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()

      const deleteStatusJob = await getQueueJobById(
        db,
        getHashFromString(`${statusId}#delete`)
      )
      expect(deleteStatusJob?.name).toBe(SEND_DELETE_NOTE_JOB_NAME)

      const deleteBskyJob = await getQueueJobById(
        db,
        getHashFromString(`${statusId}#bluesky-crosspost-delete`)
      )
      expect(deleteBskyJob).not.toBeNull()
      expect(deleteBskyJob?.name).toBe(DELETE_BLUESKY_CROSSPOST_JOB_NAME)
      expect(deleteBskyJob?.payload).toMatchObject({
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        data: { actorId: actor.id, uri }
      })
    })

    it('queues a Bluesky delete for the parent and its same-actor reply on the database queue', async () => {
      const { parentStatusId, replyStatusId, parentUri, replyUri } =
        await createCrosspostedReplyTree()

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId: parentStatusId,
        database
      })

      for (const [statusId, uri] of [
        [parentStatusId, parentUri],
        [replyStatusId, replyUri]
      ] as const) {
        const job = await getQueueJobById(
          db,
          getHashFromString(`${statusId}#bluesky-crosspost-delete`)
        )
        expect(job).not.toBeNull()
        expect(job?.name).toBe(DELETE_BLUESKY_CROSSPOST_JOB_NAME)
        expect(job?.payload).toMatchObject({
          name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
          data: { actorId: actor.id, uri }
        })
        expect(await database.getStatus({ statusId })).toBeNull()
        expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      }
    })

    it('queues a Bluesky delete for the parent and its same-actor reply on a non-database queue', async () => {
      currentMockConfig = { queue: undefined }
      const noQueue = new NoQueue()
      const publishSpy = vi
        .spyOn(noQueue, 'publish')
        .mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(noQueue)

      const { parentStatusId, replyStatusId, parentUri, replyUri } =
        await createCrosspostedReplyTree()

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId: parentStatusId,
        database
      })

      for (const [statusId, uri] of [
        [parentStatusId, parentUri],
        [replyStatusId, replyUri]
      ] as const) {
        expect(publishSpy).toHaveBeenCalledWith({
          id: getHashFromString(`${statusId}#bluesky-crosspost-delete`),
          name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
          data: { actorId: actor.id, uri }
        })
        expect(await database.getStatus({ statusId })).toBeNull()
        expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      }
    })

    it('keeps the bluesky_crossposts row when deleteStatusWithQueueJob rolls back so a retry still queues the Bluesky delete', async () => {
      const statusId = `${actor.id}/statuses/integration-crosspost-rollback-dbq`
      const uri =
        'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3krollbackdbq'
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Cross-posted note for rollback test'
      })
      await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: attemptId!,
        uri,
        cid: 'bafyrollbackdbq'
      })

      // Break a table deleted AFTER bluesky_crossposts inside executeStatusDeletion
      // so the cross-post DELETE ... RETURNING runs and must roll back with the tx.
      await db.schema
        .alterTable('bookmarks')
        .renameTo('bookmarks_bak')
        .execute()
      try {
        await expect(
          deleteStatusFromUserInput({
            currentActor: actor,
            statusId,
            database
          })
        ).rejects.toThrow()
      } finally {
        await db.schema
          .alterTable('bookmarks_bak')
          .renameTo('bookmarks')
          .execute()
      }

      // Status and cross-post row both survive the rollback; neither job was persisted.
      expect(await database.getStatus({ statusId })).not.toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        statusId,
        state: 'posted',
        uri
      })
      expect(
        await getQueueJobById(db, getHashFromString(`${statusId}#delete`))
      ).toBeNull()
      expect(
        await getQueueJobById(
          db,
          getHashFromString(`${statusId}#bluesky-crosspost-delete`)
        )
      ).toBeNull()

      // Retrying now succeeds and queues both jobs atomically.
      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId,
        database
      })

      expect(await database.getStatus({ statusId })).toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      expect(
        await getQueueJobById(db, getHashFromString(`${statusId}#delete`))
      ).toMatchObject({ name: SEND_DELETE_NOTE_JOB_NAME })
      expect(
        await getQueueJobById(
          db,
          getHashFromString(`${statusId}#bluesky-crosspost-delete`)
        )
      ).toMatchObject({
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        payload: {
          name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
          data: { actorId: actor.id, uri }
        }
      })
    })

    it('keeps the bluesky_crossposts row when deleteStatus rolls back on a non-database queue so a retry queues the Bluesky delete', async () => {
      currentMockConfig = { queue: undefined }
      const noQueue = new NoQueue()
      const publishSpy = vi
        .spyOn(noQueue, 'publish')
        .mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(noQueue)

      const statusId = `${actor.id}/statuses/integration-crosspost-rollback-noq`
      const uri =
        'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3krollbacknoq'
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Cross-posted note for NoQueue rollback test'
      })
      await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: attemptId!,
        uri,
        cid: 'bafyrollbacknoq'
      })

      await db.schema
        .alterTable('bookmarks')
        .renameTo('bookmarks_bak')
        .execute()
      try {
        await expect(
          deleteStatusFromUserInput({
            currentActor: actor,
            statusId,
            database
          })
        ).rejects.toThrow()
      } finally {
        await db.schema
          .alterTable('bookmarks_bak')
          .renameTo('bookmarks')
          .execute()
      }

      // Status and cross-post row survive; nothing was published.
      expect(await database.getStatus({ statusId })).not.toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        statusId,
        state: 'posted',
        uri
      })
      expect(publishSpy).not.toHaveBeenCalled()

      // Retrying now deletes both and publishes both jobs.
      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId,
        database
      })

      expect(await database.getStatus({ statusId })).toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: getHashFromString(`${statusId}#delete`),
          name: SEND_DELETE_NOTE_JOB_NAME
        })
      )
      expect(publishSpy).toHaveBeenCalledWith({
        id: getHashFromString(`${statusId}#bluesky-crosspost-delete`),
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        data: { actorId: actor.id, uri }
      })
    })

    it('drops an in-flight posting row on deleteStatusWithQueueJob so the worker cleans up its own record', async () => {
      const statusId = `${actor.id}/statuses/integration-crosspost-posting`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'In-flight cross-post'
      })
      await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId,
        database
      })

      expect(await database.getStatus({ statusId })).toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      expect(
        await getQueueJobById(
          db,
          getHashFromString(`${statusId}#bluesky-crosspost-delete`)
        )
      ).toBeNull()
      // The in-flight attempt's markPosted returns false so it deletes its record.
      expect(
        await database.markBlueskyCrosspostPosted({
          statusId,
          attemptId: attemptId!,
          uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3kpost',
          cid: 'bafypost'
        })
      ).toBe(false)
    })

    it('drops an in-flight posting row on a non-database queue without queuing a Bluesky delete', async () => {
      currentMockConfig = { queue: undefined }
      const noQueue = new NoQueue()
      const publishSpy = vi
        .spyOn(noQueue, 'publish')
        .mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(noQueue)

      const statusId = `${actor.id}/statuses/integration-crosspost-posting-noq`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'In-flight cross-post on NoQueue'
      })
      await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId,
        database
      })

      expect(await database.getStatus({ statusId })).toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      expect(publishSpy).toHaveBeenCalledTimes(1)
      expect(publishSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: DELETE_BLUESKY_CROSSPOST_JOB_NAME })
      )
      expect(
        await database.markBlueskyCrosspostPosted({
          statusId,
          attemptId: attemptId!,
          uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3kpostnoq',
          cid: 'bafypostnoq'
        })
      ).toBe(false)
    })

    it('queues DELETE_BLUESKY_CROSSPOST_JOB_NAME with deterministic uri when deleting a status with a failed row on the database queue', async () => {
      const ownDid = `did:plc:${'c'.repeat(24)}`
      await database.saveBlueskyAccount({
        actorId: actor.id,
        did: ownDid,
        handle: 'author.bsky.social',
        pdsUrl: 'https://pds.example.net/',
        authType: 'app_password',
        domainHandle: false
      })
      const statusId = `${actor.id}/statuses/integration-crosspost-failed-dbq`
      const createdAt = 1_730_000_001_000
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Failed cross-post on DB queue',
        createdAt
      })
      await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })
      await database.markBlueskyCrosspostFailedIfAttemptable({
        statusId,
        error: 'Bluesky gave an unexpected answer.'
      })

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId,
        database
      })

      const expectedUri = `at://${ownDid}/app.bsky.feed.post/${deterministicTid(createdAt, statusId)}`
      const expectedJobId = getHashFromString(
        `${statusId}#bluesky-crosspost-delete`
      )
      expect(await database.getStatus({ statusId })).toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      expect(await getQueueJobById(db, expectedJobId)).toMatchObject({
        id: expectedJobId,
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        status: 'pending',
        payload: {
          id: expectedJobId,
          name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
          data: {
            actorId: actor.id,
            uri: expectedUri,
            expectedCreatedAt: new Date(createdAt).toISOString()
          }
        }
      })
    })

    it('queues DELETE_BLUESKY_CROSSPOST_JOB_NAME with deterministic uri when deleting a status with a failed row on a non-database queue', async () => {
      currentMockConfig = { queue: undefined }
      const noQueue = new NoQueue()
      const publishSpy = vi
        .spyOn(noQueue, 'publish')
        .mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(noQueue)

      const ownDid = `did:plc:${'d'.repeat(24)}`
      await database.saveBlueskyAccount({
        actorId: actor.id,
        did: ownDid,
        handle: 'author.bsky.social',
        pdsUrl: 'https://pds.example.net/',
        authType: 'app_password',
        domainHandle: false
      })
      const statusId = `${actor.id}/statuses/integration-crosspost-failed-noq`
      const createdAt = 1_730_000_002_000
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Failed cross-post on NoQueue',
        createdAt
      })
      await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })
      await database.markBlueskyCrosspostFailedIfAttemptable({
        statusId,
        error: 'Bluesky gave an unexpected answer.'
      })

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId,
        database
      })

      const expectedUri = `at://${ownDid}/app.bsky.feed.post/${deterministicTid(createdAt, statusId)}`
      expect(await database.getStatus({ statusId })).toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      expect(publishSpy).toHaveBeenCalledWith({
        id: getHashFromString(`${statusId}#bluesky-crosspost-delete`),
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        data: {
          actorId: actor.id,
          uri: expectedUri,
          expectedCreatedAt: new Date(createdAt).toISOString()
        }
      })
    })

    it('skips queuing DELETE_BLUESKY_CROSSPOST_JOB_NAME when deleting a status with a collision-failed cross-post row on both queues', async () => {
      const ownDid = `did:plc:${'9'.repeat(24)}`
      await database.saveBlueskyAccount({
        actorId: actor.id,
        did: ownDid,
        handle: 'author.bsky.social',
        pdsUrl: 'https://pds.example.net/',
        authType: 'app_password',
        domainHandle: false
      })

      // Database queue
      const dbqStatusId = `${actor.id}/statuses/integration-collision-dbq`
      await database.createNote({
        id: dbqStatusId,
        url: dbqStatusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Collision failed on DB queue',
        createdAt: 1_730_000_005_000
      })
      await database.claimBlueskyCrosspost({
        statusId: dbqStatusId,
        actorId: actor.id
      })
      await database.markBlueskyCrosspostFailedIfAttemptable({
        statusId: dbqStatusId,
        error: BLUESKY_CROSSPOST_COLLISION_MESSAGE
      })

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId: dbqStatusId,
        database
      })

      expect(
        await database.getBlueskyCrosspost({ statusId: dbqStatusId })
      ).toBeNull()
      expect(
        await getQueueJobById(
          db,
          getHashFromString(`${dbqStatusId}#bluesky-crosspost-delete`)
        )
      ).toBeNull()

      // Non-database queue
      currentMockConfig = { queue: undefined }
      const noQueue = new NoQueue()
      const publishSpy = vi
        .spyOn(noQueue, 'publish')
        .mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(noQueue)

      const noqStatusId = `${actor.id}/statuses/integration-collision-noq`
      await database.createNote({
        id: noqStatusId,
        url: noqStatusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Collision failed on NoQueue',
        createdAt: 1_730_000_006_000
      })
      await database.claimBlueskyCrosspost({
        statusId: noqStatusId,
        actorId: actor.id
      })
      await database.markBlueskyCrosspostFailedIfAttemptable({
        statusId: noqStatusId,
        error: BLUESKY_CROSSPOST_COLLISION_MESSAGE
      })

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId: noqStatusId,
        database
      })

      expect(
        await database.getBlueskyCrosspost({ statusId: noqStatusId })
      ).toBeNull()
      expect(publishSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: DELETE_BLUESKY_CROSSPOST_JOB_NAME })
      )
    })

    it('queues DELETE_BLUESKY_CROSSPOST_JOB_NAME with each reply own createdAt when deleting a reply tree with a failed reply row', async () => {
      const ownDid = `did:plc:${'e'.repeat(24)}`
      await database.saveBlueskyAccount({
        actorId: actor.id,
        did: ownDid,
        handle: 'author.bsky.social',
        pdsUrl: 'https://pds.example.net/',
        authType: 'app_password',
        domainHandle: false
      })
      const parentStatusId = `${actor.id}/statuses/integration-tree-parent-failed`
      const replyStatusId = `${actor.id}/statuses/integration-tree-reply-failed`
      const parentCreatedAt = 1_730_000_010_000
      const replyCreatedAt = 1_730_000_099_000
      const parentUri = `at://${ownDid}/app.bsky.feed.post/${deterministicTid(parentCreatedAt, parentStatusId)}`
      await database.createNote({
        id: parentStatusId,
        url: parentStatusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Posted parent',
        createdAt: parentCreatedAt
      })
      await database.createNote({
        id: replyStatusId,
        url: replyStatusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Failed reply',
        reply: parentStatusId,
        createdAt: replyCreatedAt
      })
      await database.claimBlueskyCrosspost({
        statusId: parentStatusId,
        actorId: actor.id
      })
      const parentAttempt = await database.beginBlueskyCrosspostAttempt({
        statusId: parentStatusId
      })
      await database.markBlueskyCrosspostPosted({
        statusId: parentStatusId,
        attemptId: parentAttempt!,
        uri: parentUri,
        cid: 'bafyparent'
      })
      await database.claimBlueskyCrosspost({
        statusId: replyStatusId,
        actorId: actor.id
      })
      await database.markBlueskyCrosspostFailedIfAttemptable({
        statusId: replyStatusId,
        error: 'Bluesky gave an unexpected answer.'
      })

      await deleteStatusFromUserInput({
        currentActor: actor,
        statusId: parentStatusId,
        database
      })

      const expectedReplyUri = `at://${ownDid}/app.bsky.feed.post/${deterministicTid(replyCreatedAt, replyStatusId)}`
      expect(
        await getQueueJobById(
          db,
          getHashFromString(`${replyStatusId}#bluesky-crosspost-delete`)
        )
      ).toMatchObject({
        name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
        payload: {
          name: DELETE_BLUESKY_CROSSPOST_JOB_NAME,
          data: {
            actorId: actor.id,
            uri: expectedReplyUri,
            expectedCreatedAt: new Date(replyCreatedAt).toISOString()
          }
        }
      })
    })
  })
})

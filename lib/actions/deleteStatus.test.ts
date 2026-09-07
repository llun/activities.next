import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { SEND_DELETE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { CloudTasksQueue } from '@/lib/services/queue/cloudtasks'
import { DatabaseQueue } from '@/lib/services/queue/database'
import { NoQueue } from '@/lib/services/queue/noqueue'
import { QStashQueue } from '@/lib/services/queue/qstash'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

let currentMockConfig: { queue?: any } = { queue: undefined }

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => currentMockConfig)
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

const CURRENT_ACTOR = { id: 'https://llun.test/users/me' } as Actor

const createDatabase = (status: Status | null) =>
  ({
    getStatus: vi.fn().mockResolvedValue(status),
    deleteStatus: vi.fn().mockResolvedValue(undefined),
    deleteStatusWithQueueJob: vi.fn().mockResolvedValue(true)
  }) as unknown as Database

describe('deleteStatusFromUserInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentMockConfig = { queue: undefined }
  })

  describe('Database queue backend', () => {
    beforeEach(() => {
      currentMockConfig = {
        queue: { type: 'database', maxRetries: 16 }
      }
      const dbQueue = new DatabaseQueue(currentMockConfig.queue)
      vi.spyOn(dbQueue, 'publish')
      vi.mocked(getQueue).mockReturnValue(dbQueue)
    })

    it('atomically deletes status and enqueues deletion job via deleteStatusWithQueueJob', async () => {
      const status = {
        id: 'https://llun.test/users/me/statuses/db-delete-1',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: ['https://llun.test/users/me/followers']
      } as Status
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
        }
      })

      // Must not separately delete or publish
      expect(database.deleteStatus).not.toHaveBeenCalled()
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('respects custom maxRetries from DatabaseQueueConfig', async () => {
      currentMockConfig = {
        queue: { type: 'database', maxRetries: 5 }
      }
      const dbQueue = new DatabaseQueue(currentMockConfig.queue)
      vi.mocked(getQueue).mockReturnValue(dbQueue)

      const status = {
        id: 'https://llun.test/users/me/statuses/db-custom-retries',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
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
      const status = {
        id: 'https://llun.test/users/me/statuses/snapshot-test',
        actorId: CURRENT_ACTOR.id,
        to: ['https://remote.example/users/alice', ACTIVITY_STREAM_PUBLIC],
        cc: ['https://remote.example/users/bob']
      } as Status
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
      const status = {
        id: 'https://llun.test/users/me/statuses/db-tx-fail',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
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

    it('rejects deletion when status is owned by another actor', async () => {
      const status = {
        id: 'https://llun.test/users/other/statuses/unauthorized',
        actorId: 'https://llun.test/users/other',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      expect(database.deleteStatusWithQueueJob).not.toHaveBeenCalled()
      expect(database.deleteStatus).not.toHaveBeenCalled()
      expect(getQueue().publish).not.toHaveBeenCalled()
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

    it('handles repeated deletion gracefully when deleteStatusWithQueueJob returns false', async () => {
      const status = {
        id: 'https://llun.test/users/me/statuses/race-condition',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
      const database = createDatabase(status)
      vi.mocked(database.deleteStatusWithQueueJob).mockResolvedValueOnce(false)

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
      currentMockConfig = {
        queue: {
          type: 'qstash',
          url: 'https://qstash.example.com',
          token: 'token',
          currentSigningKey: 'sig1',
          nextSigningKey: 'sig2'
        }
      }
      qstashQueue = new QStashQueue(currentMockConfig.queue)
      vi.spyOn(qstashQueue, 'publish').mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(qstashQueue)
    })

    it('deletes locally before publishing to QStash', async () => {
      const status = {
        id: 'https://llun.test/users/me/statuses/qstash-delete',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: ['https://remote.example/users/bob']
      } as Status
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
      const status = {
        id: 'https://llun.test/users/me/statuses/qstash-fail',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
      const database = createDatabase(status)
      vi.spyOn(qstashQueue, 'publish').mockRejectedValueOnce(
        new Error('QStash network error')
      )
      const loggerSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => logger)

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
      loggerSpy.mockRestore()
    })

    it('rejects deletion when status is owned by another actor', async () => {
      const status = {
        id: 'https://llun.test/users/other/statuses/qstash-unauthorized',
        actorId: 'https://llun.test/users/other',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
      const database = createDatabase(status)

      await deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })

      expect(database.deleteStatus).not.toHaveBeenCalled()
      expect(qstashQueue.publish).not.toHaveBeenCalled()
    })
  })

  describe('CloudTasks queue backend', () => {
    let cloudTasksQueue: CloudTasksQueue

    beforeEach(() => {
      currentMockConfig = {
        queue: {
          type: 'cloudtasks',
          location: 'us-central1',
          project: 'test-project'
        }
      }
      cloudTasksQueue = new CloudTasksQueue(currentMockConfig.queue)
      vi.spyOn(cloudTasksQueue, 'publish').mockResolvedValue(undefined)
      vi.mocked(getQueue).mockReturnValue(cloudTasksQueue)
    })

    it('deletes locally before publishing to CloudTasks', async () => {
      const status = {
        id: 'https://llun.test/users/me/statuses/cloudtasks-delete',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
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
      const status = {
        id: 'https://llun.test/users/me/statuses/cloudtasks-fail',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
      const database = createDatabase(status)
      vi.spyOn(cloudTasksQueue, 'publish').mockRejectedValueOnce(
        new Error('CloudTasks quota exceeded')
      )
      const loggerSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => logger)

      await expect(
        deleteStatusFromUserInput({
          currentActor: CURRENT_ACTOR,
          statusId: status.id,
          database
        })
      ).resolves.toBeUndefined()

      expect(loggerSpy).toHaveBeenCalled()
      loggerSpy.mockRestore()
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
      const status = {
        id: 'https://llun.test/users/me/statuses/inline-delete',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
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
      const status = {
        id: 'https://llun.test/users/me/statuses/inline-fail',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
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
      const status = {
        id: 'https://llun.test/users/me/statuses/local-db-fail',
        actorId: CURRENT_ACTOR.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as Status
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
  })

  describe('Immediate local disappearance (Integration with SQL Database)', () => {
    let database: Database
    let actor: Actor

    beforeEach(async () => {
      database = await getTestSQLDatabase()
      await database.migrate()
      currentMockConfig = {
        queue: { type: 'database', maxRetries: 16 }
      }
      const dbQueue = new DatabaseQueue(currentMockConfig.queue, database)
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

    it('immediately deletes status and persists pending queue job in SQLite', async () => {
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
      const persistedJob = await database.getQueueJobById(expectedJobId)
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
      const persistedJob = await database.getQueueJobById(expectedJobId)
      expect(persistedJob).toBeNull()
    })
  })
})

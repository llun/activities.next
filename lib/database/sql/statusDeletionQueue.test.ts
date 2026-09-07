import { Knex } from 'knex'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  getTestDatabaseTable,
  getTestDatabaseWithInstance
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { CreateQueueJobParams } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import * as searchModule from './search'

const table = getTestDatabaseTable()

describe.each(table)('deleteStatusWithQueueJob (%s)', (backendName) => {
  let database: Database
  let knexDatabase: Knex
  let destroy: () => Promise<void>
  let primaryActor: Actor
  let secondaryActor: Actor

  beforeAll(async () => {
    const testDb = getTestDatabaseWithInstance(true, backendName)
    database = testDb.database
    knexDatabase = testDb.instance
    destroy = async () => {
      await database.destroy()
    }
    await testDb.prepare()
    await database.migrate()

    const domain = `test-${backendName}.local`
    await database.createAccount({
      email: `primary-${backendName}@${domain}`,
      username: `primary_${backendName}`,
      passwordHash: 'dummy-password-hash',
      domain,
      privateKey: 'dummy-private-key-1',
      publicKey: 'dummy-public-key-1'
    })
    await database.createAccount({
      email: `secondary-${backendName}@${domain}`,
      username: `secondary_${backendName}`,
      passwordHash: 'dummy-password-hash',
      domain,
      privateKey: 'dummy-private-key-2',
      publicKey: 'dummy-public-key-2'
    })

    const foundPrimary = await database.getActorFromEmail({
      email: `primary-${backendName}@${domain}`
    })
    const foundSecondary = await database.getActorFromEmail({
      email: `secondary-${backendName}@${domain}`
    })
    if (!foundPrimary || !foundSecondary) {
      throw new Error('Failed to seed actors for statusDeletionQueue tests')
    }
    primaryActor = foundPrimary
    secondaryActor = foundSecondary
  }, 30000)

  afterAll(async () => {
    await destroy?.()
  })

  it('atomically deletes status and inserts queue job, cascading dependents and refreshing hashtags', async () => {
    const statusId = `${primaryActor.id}/statuses/atomic-success-post`
    const replyId = `${primaryActor.id}/statuses/atomic-success-reply`
    const hashtagName = `#atomic_${backendName}`

    const note = await database.createNote({
      id: statusId,
      url: statusId,
      actorId: primaryActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${primaryActor.id}/followers`],
      text: `Testing atomic deletion with ${hashtagName}`
    })
    expect(note).not.toBeNull()

    const reply = await database.createNote({
      id: replyId,
      url: replyId,
      actorId: primaryActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${primaryActor.id}/followers`],
      text: 'Reply to be cascaded',
      reply: statusId
    })
    expect(reply).not.toBeNull()

    await database.createTag({
      statusId,
      name: hashtagName,
      value: `https://${primaryActor.domain}/tags/atomic_${backendName}`,
      type: 'hashtag'
    })

    await database.createLike({
      actorId: secondaryActor.id,
      statusId
    })

    // Index search document to test refresh
    await database.indexStatusSearchDocument({ statusId })

    const queueJobId = `job-atomic-success-${backendName}-${Date.now()}`
    const queueJob: CreateQueueJobParams = {
      id: queueJobId,
      name: 'sendDeleteNote',
      payload: {
        id: queueJobId,
        name: 'sendDeleteNote',
        data: {
          actorId: primaryActor.id,
          statusId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${primaryActor.id}/followers`]
        }
      }
    }

    const indexSpy = vi.spyOn(searchModule, 'indexHashtagSearchDocuments')

    const result = await database.deleteStatusWithQueueJob({
      actorId: primaryActor.id,
      statusId,
      queueJob
    })

    expect(result).toBe(true)

    // Status and reply are deleted
    const fetchedRoot = await database.getStatus({ statusId })
    expect(fetchedRoot).toBeNull()
    const fetchedReply = await database.getStatus({ statusId: replyId })
    expect(fetchedReply).toBeNull()

    // Dependent likes and tags are deleted
    const remainingLikes = await knexDatabase('likes').where({ statusId })
    expect(remainingLikes).toHaveLength(0)
    const remainingTags = await knexDatabase('tags').where({ statusId })
    expect(remainingTags).toHaveLength(0)

    // Queue job is inserted
    const persistedJob = await database.getQueueJobById(queueJobId)
    expect(persistedJob).not.toBeNull()
    expect(persistedJob?.id).toBe(queueJobId)
    expect(persistedJob?.name).toBe('sendDeleteNote')
    expect(persistedJob?.status).toBe('pending')
    expect(persistedJob?.payload).toEqual(queueJob.payload)

    // Hashtag search refresh was called
    expect(indexSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        hashtags: expect.arrayContaining([hashtagName])
      })
    )

    indexSpy.mockRestore()
  })

  it('returns false and creates no queue job on wrong ownership', async () => {
    const statusId = `${primaryActor.id}/statuses/wrong-ownership-post`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: primaryActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${primaryActor.id}/followers`],
      text: 'Belongs to primary actor'
    })

    const queueJobId = `job-wrong-owner-${backendName}-${Date.now()}`
    const queueJob: CreateQueueJobParams = {
      id: queueJobId,
      name: 'sendDeleteNote',
      payload: {
        id: queueJobId,
        name: 'sendDeleteNote',
        data: {
          actorId: secondaryActor.id,
          statusId
        }
      }
    }

    const result = await database.deleteStatusWithQueueJob({
      actorId: secondaryActor.id, // Wrong owner!
      statusId,
      queueJob
    })

    expect(result).toBe(false)

    // Status must still exist
    const fetched = await database.getStatus({ statusId })
    expect(fetched).not.toBeNull()

    // No queue job created
    const persistedJob = await database.getQueueJobById(queueJobId)
    expect(persistedJob).toBeNull()
  })

  it('returns false and creates no queue job when status is missing', async () => {
    const missingStatusId = `${primaryActor.id}/statuses/nonexistent-${Date.now()}`
    const queueJobId = `job-missing-status-${backendName}-${Date.now()}`
    const queueJob: CreateQueueJobParams = {
      id: queueJobId,
      name: 'sendDeleteNote',
      payload: {
        id: queueJobId,
        name: 'sendDeleteNote',
        data: {
          actorId: primaryActor.id,
          statusId: missingStatusId
        }
      }
    }

    const result = await database.deleteStatusWithQueueJob({
      actorId: primaryActor.id,
      statusId: missingStatusId,
      queueJob
    })

    expect(result).toBe(false)

    const persistedJob = await database.getQueueJobById(queueJobId)
    expect(persistedJob).toBeNull()
  })

  it('handles duplicate requests cleanly without creating extra queue jobs', async () => {
    const statusId = `${primaryActor.id}/statuses/duplicate-request-post-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: primaryActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${primaryActor.id}/followers`],
      text: 'Post for duplicate deletion test'
    })

    const queueJobId = `job-duplicate-req-${backendName}-${Date.now()}`
    const queueJob: CreateQueueJobParams = {
      id: queueJobId,
      name: 'sendDeleteNote',
      payload: {
        id: queueJobId,
        name: 'sendDeleteNote',
        data: {
          actorId: primaryActor.id,
          statusId
        }
      }
    }

    // First request succeeds
    const firstResult = await database.deleteStatusWithQueueJob({
      actorId: primaryActor.id,
      statusId,
      queueJob
    })
    expect(firstResult).toBe(true)

    // Second (duplicate) request returns false
    const secondResult = await database.deleteStatusWithQueueJob({
      actorId: primaryActor.id,
      statusId,
      queueJob
    })
    expect(secondResult).toBe(false)

    // Exactly one job exists in queue_jobs
    const jobs = await knexDatabase('queue_jobs').where({ id: queueJobId })
    expect(jobs).toHaveLength(1)
  })

  it('restores status and dependent rows when queue job insertion fails', async () => {
    const statusId = `${primaryActor.id}/statuses/insertion-fail-post-${Date.now()}`
    const replyId = `${primaryActor.id}/statuses/insertion-fail-reply-${Date.now()}`
    const hashtagName = `#restore_${backendName}`

    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: primaryActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${primaryActor.id}/followers`],
      text: `Restore test note with ${hashtagName}`
    })

    await database.createNote({
      id: replyId,
      url: replyId,
      actorId: primaryActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${primaryActor.id}/followers`],
      text: 'Restore test reply',
      reply: statusId
    })

    await database.createTag({
      statusId,
      name: hashtagName,
      value: `https://${primaryActor.domain}/tags/restore_${backendName}`,
      type: 'hashtag'
    })

    await database.createLike({
      actorId: secondaryActor.id,
      statusId
    })

    // Temporarily rename queue_jobs table to force insertion failure in createQueueJob
    await knexDatabase.schema.renameTable('queue_jobs', 'queue_jobs_bak')

    const queueJobId = `job-insertion-fail-${backendName}-${Date.now()}`
    const queueJob: CreateQueueJobParams = {
      id: queueJobId,
      name: 'sendDeleteNote',
      payload: {
        id: queueJobId,
        name: 'sendDeleteNote',
        data: { actorId: primaryActor.id, statusId }
      }
    }

    try {
      await expect(
        database.deleteStatusWithQueueJob({
          actorId: primaryActor.id,
          statusId,
          queueJob
        })
      ).rejects.toThrow()
    } finally {
      await knexDatabase.schema.renameTable('queue_jobs_bak', 'queue_jobs')
    }

    // Status and dependent rows MUST be restored / uncommitted
    const restoredRoot = await database.getStatus({ statusId })
    expect(restoredRoot).not.toBeNull()
    const restoredReply = await database.getStatus({ statusId: replyId })
    expect(restoredReply).not.toBeNull()

    const restoredLikes = await knexDatabase('likes').where({ statusId })
    expect(restoredLikes).toHaveLength(1)

    const restoredTags = await knexDatabase('tags').where({ statusId })
    expect(restoredTags).toHaveLength(1)

    // No queue job exists
    const persistedJob = await database.getQueueJobById(queueJobId)
    expect(persistedJob).toBeNull()
  })

  it('leaves no queue job when status deletion fails midway', async () => {
    const statusId = `${primaryActor.id}/statuses/deletion-fail-post-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: primaryActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${primaryActor.id}/followers`],
      text: 'Deletion failure test note'
    })

    const queueJobId = `job-deletion-fail-${backendName}-${Date.now()}`
    const queueJob: CreateQueueJobParams = {
      id: queueJobId,
      name: 'sendDeleteNote',
      payload: {
        id: queueJobId,
        name: 'sendDeleteNote',
        data: { actorId: primaryActor.id, statusId }
      }
    }

    // Force deletion failure by temporarily renaming the likes table
    await knexDatabase.schema.renameTable('likes', 'likes_bak')

    try {
      await expect(
        database.deleteStatusWithQueueJob({
          actorId: primaryActor.id,
          statusId,
          queueJob
        })
      ).rejects.toThrow()
    } finally {
      await knexDatabase.schema.renameTable('likes_bak', 'likes')
    }

    // Transaction rolled back: no queue job was created
    const persistedJob = await database.getQueueJobById(queueJobId)
    expect(persistedJob).toBeNull()

    // Status remains untouched
    const status = await database.getStatus({ statusId })
    expect(status).not.toBeNull()
  })

  it('runs hashtag search refresh after outer transaction commits, not against uncommitted state', async () => {
    const statusId = `${primaryActor.id}/statuses/hashtag-refresh-timing-${Date.now()}`
    const hashtagName = `#timing_${backendName}`

    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: primaryActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${primaryActor.id}/followers`],
      text: `Timing note with ${hashtagName}`
    })

    await database.createTag({
      statusId,
      name: hashtagName,
      value: `https://${primaryActor.domain}/tags/timing_${backendName}`,
      type: 'hashtag'
    })

    const queueJobId = `job-timing-${backendName}-${Date.now()}`
    const queueJob: CreateQueueJobParams = {
      id: queueJobId,
      name: 'sendDeleteNote',
      payload: {
        id: queueJobId,
        name: 'sendDeleteNote',
        data: { actorId: primaryActor.id, statusId }
      }
    }

    let statusVisibleDuringRefresh: unknown = 'init'

    const indexSpy = vi
      .spyOn(searchModule, 'indexHashtagSearchDocuments')
      .mockImplementation(async () => {
        // Query the database outside any transaction to check committed state
        const row = await knexDatabase('statuses')
          .where({ id: statusId })
          .first()
        statusVisibleDuringRefresh = row ?? null
      })

    const result = await database.deleteStatusWithQueueJob({
      actorId: primaryActor.id,
      statusId,
      queueJob
    })

    expect(result).toBe(true)
    // The outer transaction already committed before indexHashtagSearchDocuments ran,
    // so the status row is ALREADY gone from committed state!
    expect(statusVisibleDuringRefresh).toBeNull()

    indexSpy.mockRestore()
  })

  it('preserves successful status deletion and queue job persistence even if hashtag search refresh throws', async () => {
    const statusId = `${primaryActor.id}/statuses/hashtag-fail-post-${Date.now()}`
    const hashtagName = `#refresh_err_${backendName}`

    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: primaryActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${primaryActor.id}/followers`],
      text: `Hashtag refresh failure post with ${hashtagName}`
    })

    await database.createTag({
      statusId,
      name: hashtagName,
      value: `https://${primaryActor.domain}/tags/refresh_err_${backendName}`,
      type: 'hashtag'
    })

    const queueJobId = `job-hashtag-err-${backendName}-${Date.now()}`
    const queueJob: CreateQueueJobParams = {
      id: queueJobId,
      name: 'sendDeleteNote',
      payload: {
        id: queueJobId,
        name: 'sendDeleteNote',
        data: { actorId: primaryActor.id, statusId }
      }
    }

    const indexSpy = vi
      .spyOn(searchModule, 'indexHashtagSearchDocuments')
      .mockRejectedValueOnce(new Error('Simulated hashtag indexing failure'))

    // The method should NOT reject because hashtag refresh is best-effort outside the committed transaction
    const result = await database.deleteStatusWithQueueJob({
      actorId: primaryActor.id,
      statusId,
      queueJob
    })

    expect(result).toBe(true)

    // Status was still deleted
    const fetched = await database.getStatus({ statusId })
    expect(fetched).toBeNull()

    // Queue job was still committed
    const persistedJob = await database.getQueueJobById(queueJobId)
    expect(persistedJob).not.toBeNull()

    indexSpy.mockRestore()
  })
})

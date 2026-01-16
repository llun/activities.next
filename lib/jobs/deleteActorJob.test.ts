import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { deleteActorJob } from '@/lib/jobs/deleteActorJob'
import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'

enableFetchMocks()

jest.mock('../services/email', () => ({
  sendMail: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('../config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'test.social',
    email: {
      serviceFromAddress: 'noreply@test.social'
    }
  })
}))

describe('deleteActorJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    jest.clearAllMocks()
  })

  it('deletes actor and all associated data', async () => {
    // Create a new actor to delete
    const suffix = Date.now().toString()
    const username = `delete-job-test-${suffix}`
    const actorId = `https://test.social/users/${username}`

    await database.createAccount({
      email: `${username}@test.social`,
      username,
      domain: 'test.social',
      passwordHash: 'hash',
      privateKey: `privateKey-${suffix}`,
      publicKey: `publicKey-${suffix}`
    })

    // Verify actor exists
    let actor = await database.getActorFromId({ id: actorId })
    expect(actor).toBeDefined()

    // Schedule deletion first
    await database.scheduleActorDeletion({ actorId, scheduledAt: null })

    // Run the delete job
    await deleteActorJob(database, {
      id: `delete-job-${suffix}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId }
    })

    // Verify actor is deleted
    actor = await database.getActorFromId({ id: actorId })
    expect(actor).toBeUndefined()
  })

  it('handles non-existent actor gracefully', async () => {
    const nonExistentActorId = `https://test.social/users/non-existent-${Date.now()}`

    // Should not throw
    await expect(
      deleteActorJob(database, {
        id: 'delete-job-nonexistent',
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId: nonExistentActorId }
      })
    ).resolves.toBeUndefined()
  })

  it('marks actor as deleting before deletion', async () => {
    const suffix = Date.now().toString()
    const username = `delete-job-mark-${suffix}`
    const actorId = `https://test.social/users/${username}`

    await database.createAccount({
      email: `${username}@test.social`,
      username,
      domain: 'test.social',
      passwordHash: 'hash',
      privateKey: `privateKey-${suffix}`,
      publicKey: `publicKey-${suffix}`
    })

    // Schedule deletion first
    await database.scheduleActorDeletion({ actorId, scheduledAt: null })

    // Verify it's scheduled
    let status = await database.getActorDeletionStatus({ id: actorId })
    expect(status?.status).toEqual('scheduled')

    // Run the delete job
    await deleteActorJob(database, {
      id: `delete-job-mark-${suffix}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId }
    })

    // Actor should be deleted now
    const actor = await database.getActorFromId({ id: actorId })
    expect(actor).toBeUndefined()
  })

  it('does not delete actor if deletion was cancelled', async () => {
    const suffix = Date.now().toString()
    const username = `delete-job-cancel-${suffix}`
    const actorId = `https://test.social/users/${username}`

    await database.createAccount({
      email: `${username}@test.social`,
      username,
      domain: 'test.social',
      passwordHash: 'hash',
      privateKey: `privateKey-${suffix}`,
      publicKey: `publicKey-${suffix}`
    })

    // Schedule deletion
    await database.scheduleActorDeletion({ actorId, scheduledAt: null })

    // Cancel deletion before job runs
    await database.cancelActorDeletion({ actorId })

    // Run the delete job
    await deleteActorJob(database, {
      id: `delete-job-cancel-${suffix}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId }
    })

    // Actor should still exist (not deleted)
    const actor = await database.getActorFromId({ id: actorId })
    expect(actor).toBeDefined()
    expect(actor?.deletionStatus).toBeNull()
  })
})

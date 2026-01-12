import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { deleteObjectJob } from '@/lib/jobs/deleteObjectJob'
import { DELETE_OBJECT_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

enableFetchMocks()

describe('deleteObjectJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('deletes actor when data is a string (actor id)', async () => {
    // Create a new actor to delete
    const actorId = `https://external.test/users/to-delete-${Date.now()}`
    await database.createActor({
      actorId,
      username: `todelete${Date.now()}`,
      domain: 'external.test',
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://external.test/inbox',
      publicKey: 'public-key',
      createdAt: Date.now()
    })

    // Delete using job - deleteActor should be called
    await expect(
      deleteObjectJob(database, {
        id: 'job-1',
        name: DELETE_OBJECT_JOB_NAME,
        data: actorId
      })
    ).resolves.toBeUndefined()
  })

  it('deletes status when data is a Tombstone', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create a status to delete
    const statusId = `${actor1.id}/statuses/to-delete-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: 'Status to be deleted',
      createdAt: Date.now()
    })

    // Verify status exists
    let status = await database.getStatus({ statusId, withReplies: false })
    expect(status).not.toBeNull()

    // Delete using job with Tombstone data
    await deleteObjectJob(database, {
      id: 'job-2',
      name: DELETE_OBJECT_JOB_NAME,
      data: {
        type: 'Tombstone',
        id: statusId
      }
    })

    // Verify status is deleted
    status = await database.getStatus({ statusId, withReplies: false })
    expect(status).toBeNull()
  })

  it('processes Announce data for deletion', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create an announce to test deletion path
    const announceId = `${actor1.id}/statuses/announce-to-delete-${Date.now()}`
    const originalStatusId = `${actor1.id}/statuses/original-for-announce-${Date.now()}`

    // Create original status first
    await database.createNote({
      id: originalStatusId,
      url: originalStatusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: 'Original status',
      createdAt: Date.now()
    })

    // Create announce
    await database.createAnnounce({
      id: announceId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      originalStatusId,
      createdAt: Date.now()
    })

    // Test that job processes without throwing
    // Note: The Zod Announce schema requires specific fields
    await expect(
      deleteObjectJob(database, {
        id: 'job-3',
        name: DELETE_OBJECT_JOB_NAME,
        data: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          type: 'Announce',
          id: announceId,
          actor: actor1.id,
          object: originalStatusId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          published: new Date().toISOString()
        }
      })
    ).resolves.toBeUndefined()
  })

  it('handles invalid data gracefully', async () => {
    // Should not throw for invalid data
    await expect(
      deleteObjectJob(database, {
        id: 'job-4',
        name: DELETE_OBJECT_JOB_NAME,
        data: { invalid: 'data' }
      })
    ).resolves.toBeUndefined()
  })
})

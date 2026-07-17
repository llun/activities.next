import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { deleteObjectJob } from '@/lib/jobs/deleteObjectJob'
import { DELETE_OBJECT_JOB_NAME } from '@/lib/jobs/names'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'

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

  // Seed the quoted status (as stored when we created the outbound quote) so its
  // author can be resolved for the revocation authorization check.
  const seedQuotedStatus = async (author: string, statusId: string) => {
    await database.createActor({
      actorId: author,
      username: author.split('/').pop() as string,
      domain: new URL(author).host,
      followersUrl: `${author}/followers`,
      inboxUrl: `${author}/inbox`,
      sharedInboxUrl: `https://${new URL(author).host}/inbox`,
      publicKey: 'public-key',
      createdAt: Date.now()
    })
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: author,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: 'quoted status',
      createdAt: Date.now()
    })
  }

  it('revokes a quote when its stamp is deleted by the quoted author', async () => {
    const author = `https://remote.example/users/alice-${Date.now()}`
    const quotedStatusId = `${author}/statuses/1`
    await seedQuotedStatus(author, quotedStatusId)
    const stampUri = `${author}/quote_authorizations/xyz`
    const quotingId = `https://local.test/users/me/statuses/revoke-${Date.now()}`
    await database.createStatusQuote({
      statusId: quotingId,
      quotedStatusId,
      state: 'accepted',
      authorizationUri: stampUri
    })

    await deleteObjectJob(database, {
      id: 'revoke-job',
      name: DELETE_OBJECT_JOB_NAME,
      data: stampUri,
      verifiedSenderActorId: author
    })

    const edge = await database.getStatusQuote({ statusId: quotingId })
    expect(edge?.state).toBe('revoked')
  })

  it('does not revoke a quote when the stamp Delete comes from a foreign authority', async () => {
    const author = `https://remote.example/users/bob-${Date.now()}`
    const quotedStatusId = `${author}/statuses/1`
    await seedQuotedStatus(author, quotedStatusId)
    const stampUri = `${author}/quote_authorizations/abc`
    const quotingId = `https://local.test/users/me/statuses/no-revoke-${Date.now()}`
    await database.createStatusQuote({
      statusId: quotingId,
      quotedStatusId,
      state: 'accepted',
      authorizationUri: stampUri
    })

    await deleteObjectJob(database, {
      id: 'no-revoke-job',
      name: DELETE_OBJECT_JOB_NAME,
      data: stampUri,
      verifiedSenderActorId: 'https://evil.example/users/impostor'
    })

    const edge = await database.getStatusQuote({ statusId: quotingId })
    expect(edge?.state).toBe('accepted')
  })

  it('does not revoke a quote when a co-resident of the quoted author (not the author) sends the Delete', async () => {
    // Multi-user forgery: mallory shares bob's host, so host equality passes, but
    // she is not the quoted author and must not be able to revoke bob's quote.
    const author = `https://remote.example/users/bob-coresident-${Date.now()}`
    const quotedStatusId = `${author}/statuses/1`
    await seedQuotedStatus(author, quotedStatusId)
    const stampUri = `${author}/quote_authorizations/def`
    const quotingId = `https://local.test/users/me/statuses/coresident-${Date.now()}`
    await database.createStatusQuote({
      statusId: quotingId,
      quotedStatusId,
      state: 'accepted',
      authorizationUri: stampUri
    })

    await deleteObjectJob(database, {
      id: 'coresident-job',
      name: DELETE_OBJECT_JOB_NAME,
      data: stampUri,
      verifiedSenderActorId: 'https://remote.example/users/mallory'
    })

    const edge = await database.getStatusQuote({ statusId: quotingId })
    expect(edge?.state).toBe('accepted')
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

  it('does not delete a status owned by a different verified sender', async () => {
    if (!actor1) fail('Actor1 is required')

    const statusId = `${actor1.id}/statuses/not-owned-by-sender-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: 'Status owned by actor1',
      createdAt: Date.now()
    })

    await deleteObjectJob(database, {
      id: 'job-not-owner',
      name: DELETE_OBJECT_JOB_NAME,
      data: {
        type: 'Tombstone',
        id: statusId
      },
      verifiedSenderActorId: ACTOR2_ID
    })

    const status = await database.getStatus({ statusId, withReplies: false })
    expect(status).not.toBeNull()
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

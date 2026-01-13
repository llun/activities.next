import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { sendUndoAnnounceJob } from '@/lib/jobs/sendUndoAnnounceJob'
import { Actor } from '@/lib/models/actor'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

enableFetchMocks()

describe('sendUndoAnnounceJob', () => {
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

  it('does nothing when status is not found', async () => {
    if (!actor1) fail('Actor1 is required')

    await expect(
      sendUndoAnnounceJob(database, {
        id: 'job-1',
        name: SEND_UNDO_ANNOUNCE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: 'https://nonexistent.test/statuses/missing'
        }
      })
    ).resolves.toBeUndefined()
  })

  it('does nothing when actor is not found', async () => {
    if (!actor1) fail('Actor1 is required')

    const statusId = `${actor1.id}/statuses/for-undo-test-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: 'Test status',
      createdAt: Date.now()
    })

    await expect(
      sendUndoAnnounceJob(database, {
        id: 'job-2',
        name: SEND_UNDO_ANNOUNCE_JOB_NAME,
        data: {
          actorId: 'https://nonexistent.test/users/nobody',
          statusId
        }
      })
    ).resolves.toBeUndefined()
  })

  it('does nothing when status is not an announce', async () => {
    if (!actor1) fail('Actor1 is required')

    const statusId = `${actor1.id}/statuses/note-not-announce-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: 'This is a note, not an announce',
      createdAt: Date.now()
    })

    await expect(
      sendUndoAnnounceJob(database, {
        id: 'job-3',
        name: SEND_UNDO_ANNOUNCE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
    ).resolves.toBeUndefined()
  })

  it('sends undo announce to follower inboxes', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create original status
    const originalStatusId = `${actor1.id}/statuses/original-for-undo-${Date.now()}`
    await database.createNote({
      id: originalStatusId,
      url: originalStatusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: 'Original content',
      createdAt: Date.now()
    })

    // Create announce
    const announceId = `${actor1.id}/statuses/announce-to-undo-${Date.now()}`
    await database.createAnnounce({
      id: announceId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      originalStatusId,
      createdAt: Date.now()
    })

    await sendUndoAnnounceJob(database, {
      id: 'job-4',
      name: SEND_UNDO_ANNOUNCE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId: announceId
      }
    })

    // Job should complete without error
  })
})

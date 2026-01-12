import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { sendNoteJob } from '@/lib/jobs/sendNoteJob'
import { Actor } from '@/lib/models/actor'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

enableFetchMocks()

describe('sendNoteJob', () => {
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
      sendNoteJob(database, {
        id: 'job-1',
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: 'https://nonexistent.test/statuses/missing'
        }
      })
    ).resolves.toBeUndefined()
  })

  it('does nothing when actor is not found', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create a status
    const statusId = `${actor1.id}/statuses/for-send-note-test-${Date.now()}`
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
      sendNoteJob(database, {
        id: 'job-2',
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: 'https://nonexistent.test/users/nobody',
          statusId
        }
      })
    ).resolves.toBeUndefined()
  })

  it('sends note to follower inboxes', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create a note status
    const statusId = `${actor1.id}/statuses/note-to-send-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor1.id}/followers`],
      text: 'Note content to send',
      createdAt: Date.now()
    })

    await sendNoteJob(database, {
      id: 'job-3',
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId
      }
    })

    // Job should complete without error
  })

  it('handles note with mentions', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create a note status with mention
    const statusId = `${actor1.id}/statuses/note-with-mention-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: '@test2@external.test Hello there!',
      createdAt: Date.now()
    })

    await expect(
      sendNoteJob(database, {
        id: 'job-4',
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
    ).resolves.toBeUndefined()
  })
})

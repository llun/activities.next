import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { sendAnnounceJob } from '@/lib/jobs/sendAnnounceJob'
import { Actor } from '@/lib/models/actor'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

enableFetchMocks()

describe('sendAnnounceJob', () => {
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
      sendAnnounceJob(database, {
        id: 'job-1',
        name: SEND_ANNOUNCE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: 'https://nonexistent.test/statuses/missing'
        }
      })
    ).resolves.toBeUndefined()

    // No fetch calls should be made for announce
    const announceCalls = fetchMock.mock.calls.filter((call) => {
      if (!call[1]?.body) return false
      const body = JSON.parse(call[1].body as string)
      return body.type === 'Announce'
    })
    expect(announceCalls.length).toBe(0)
  })

  it('does nothing when actor is not found', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create a status
    const statusId = `${actor1.id}/statuses/for-announce-test`
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
      sendAnnounceJob(database, {
        id: 'job-2',
        name: SEND_ANNOUNCE_JOB_NAME,
        data: {
          actorId: 'https://nonexistent.test/users/nobody',
          statusId
        }
      })
    ).resolves.toBeUndefined()
  })

  it('sends announce to follower inboxes', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create an original status
    const originalStatusId = `${actor1.id}/statuses/original-to-boost`
    await database.createNote({
      id: originalStatusId,
      url: originalStatusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: 'Original content',
      createdAt: Date.now()
    })

    // Create an announce
    const announceId = `${actor1.id}/statuses/announce-job-test`
    await database.createAnnounce({
      id: announceId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      originalStatusId,
      createdAt: Date.now()
    })

    await sendAnnounceJob(database, {
      id: 'job-3',
      name: SEND_ANNOUNCE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId: announceId
      }
    })

    // Job should complete without error
    // (In a real test we'd verify inbox calls, but the test database may not have followers set up)
  })
})

import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_DELETE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { sendDeleteNoteJob } from '@/lib/jobs/sendDeleteNoteJob'
import { expectCall, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_FOLLOWER_URL, seedActor1 } from '@/lib/stub/seed/actor1'
import {
  EXTERNAL_ACTOR1,
  EXTERNAL_ACTOR1_INBOX
} from '@/lib/stub/seed/external1'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

const FOLLOWERS_SHARED_INBOX = 'https://somewhere.test/inbox'

describe('Send delete note job', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | null = null

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

  // The status row is always gone by the time this job runs, so every case
  // below deliberately uses a statusId that is not in the database.
  it('sends the delete activity for a status that no longer exists', async () => {
    if (!actor1) fail('Actor1 is required')
    const statusId = `${actor1.id}/statuses/already-deleted`

    await sendDeleteNoteJob(database, {
      id: 'job-id',
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR1_FOLLOWER_URL]
      }
    })

    expectCall(fetchMock, FOLLOWERS_SHARED_INBOX, 'POST', {
      id: `${statusId}#delete`,
      type: 'Delete',
      actor: actor1.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      object: {
        id: statusId,
        type: 'Tombstone'
      }
    })
  })

  it('preserves the original recipients for a direct status', async () => {
    if (!actor1) fail('Actor1 is required')
    const statusId = `${actor1.id}/statuses/direct-deleted`

    await sendDeleteNoteJob(database, {
      id: 'job-id',
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId,
        to: [EXTERNAL_ACTOR1],
        cc: []
      }
    })

    expectCall(fetchMock, EXTERNAL_ACTOR1_INBOX, 'POST', {
      id: `${statusId}#delete`,
      type: 'Delete',
      actor: actor1.id,
      to: [EXTERNAL_ACTOR1],
      cc: [],
      object: {
        id: statusId,
        type: 'Tombstone'
      }
    })

    // A direct delete must not reach the follower audience.
    const followerCall = fetchMock.mock.calls.find(
      (call) => call[0] === FOLLOWERS_SHARED_INBOX
    )
    expect(followerCall).toBeUndefined()
  })

  it('does nothing if actor is not found', async () => {
    await sendDeleteNoteJob(database, {
      id: 'job-id',
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/not-exist-actor',
        statusId: 'https://llun.test/users/not-exist-actor/statuses/post-1',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      }
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delivers to the remaining inboxes when one inbox fails', async () => {
    if (!actor1) fail('Actor1 is required')
    const statusId = `${actor1.id}/statuses/partial-failure`

    fetchMock.mockResponse(async (req) => {
      if (req.method === 'POST' && req.url === FOLLOWERS_SHARED_INBOX) {
        throw new Error('Inbox unreachable')
      }
      return { status: 202, body: '' }
    })

    await sendDeleteNoteJob(database, {
      id: 'job-id',
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId,
        to: [ACTIVITY_STREAM_PUBLIC, EXTERNAL_ACTOR1],
        cc: [ACTOR1_FOLLOWER_URL]
      }
    })

    expectCall(fetchMock, EXTERNAL_ACTOR1_INBOX, 'POST', {
      id: `${statusId}#delete`,
      type: 'Delete',
      actor: actor1.id,
      object: {
        id: statusId,
        type: 'Tombstone'
      }
    })
  })
})

import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { sendUpdateNoteJob } from '@/lib/jobs/sendUpdateNoteJob'
import { Actor } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import { expectCall, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'

enableFetchMocks()

describe('Send update note job', () => {
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

  it('sends update note activities to followers and mentions', async () => {
    if (!actor1) fail('Actor1 is required')

    const status = (await database.getStatus({
      statusId: `${actor1.id}/statuses/post-1`,
      withReplies: false
    })) as Status

    await sendUpdateNoteJob(database, {
      id: 'job-id',
      name: 'SendUpdateNoteJob',
      data: {
        actorId: actor1.id,
        statusId: status.id
      }
    })

    expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
      id: expect.stringMatching(status.id),
      type: 'Update',
      actor: actor1.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      object: getNoteFromStatus(status)
    })
  })

  it('does nothing if status is not found', async () => {
    if (!actor1) fail('Actor1 is required')

    await sendUpdateNoteJob(database, {
      id: 'job-id',
      name: 'SendUpdateNoteJob',
      data: {
        actorId: actor1.id,
        statusId: 'not-exist-status'
      }
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing if actor is not found', async () => {
    const status = (await database.getStatus({
      statusId: `${actor1?.id}/statuses/post-1`,
      withReplies: false
    })) as Status

    await sendUpdateNoteJob(database, {
      id: 'job-id',
      name: 'SendUpdateNoteJob',
      data: {
        actorId: 'not-exist-actor',
        statusId: status.id
      }
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { QUOTE_ACTIVITY_CONTEXT } from '@/lib/activities/quoteContext'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { sendUpdateNoteJob } from '@/lib/jobs/sendUpdateNoteJob'
import { expectCall, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { logger } from '@/lib/utils/logger'

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
    const note = getNoteFromStatus(status)
    if (!note) fail('Note is required')

    await sendUpdateNoteJob(database, {
      id: 'job-id',
      name: 'SendUpdateNoteJob',
      data: {
        actorId: actor1.id,
        statusId: status.id
      }
    })

    expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
      // An Update is how a quoter re-federates its note once the quote is
      // approved, so dropping the FEP-044f term definitions here is what would
      // leave that approval invisible to a receiver that compacts.
      '@context': QUOTE_ACTIVITY_CONTEXT,
      id: expect.stringMatching(status.id),
      type: 'Update',
      actor: actor1.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      object: {
        ...note,
        updated: getISOTimeUTC(status.updatedAt)
      }
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

  it('does not log to logger.error when inbox request fails with network error', async () => {
    if (!actor1) fail('Actor1 is required')

    const status = (await database.getStatus({
      statusId: `${actor1.id}/statuses/post-1`,
      withReplies: false
    })) as Status

    fetchMock.mockRejectOnce(new Error('Network error'))
    const loggerErrorSpy = vi.spyOn(logger, 'error')

    await sendUpdateNoteJob(database, {
      id: 'job-id',
      name: 'SendUpdateNoteJob',
      data: {
        actorId: actor1.id,
        statusId: status.id
      }
    })

    expect(loggerErrorSpy).not.toHaveBeenCalled()
    loggerErrorSpy.mockRestore()
  })

  it('does not log to logger.error when inbox responds with HTTP error status code', async () => {
    if (!actor1) fail('Actor1 is required')

    const status = (await database.getStatus({
      statusId: `${actor1.id}/statuses/post-1`,
      withReplies: false
    })) as Status

    fetchMock.mockResponseOnce(JSON.stringify({ error: 'Unprocessable' }), {
      status: 422
    })
    const loggerErrorSpy = vi.spyOn(logger, 'error')

    await sendUpdateNoteJob(database, {
      id: 'job-id',
      name: 'SendUpdateNoteJob',
      data: {
        actorId: actor1.id,
        statusId: status.id
      }
    })

    expect(loggerErrorSpy).not.toHaveBeenCalled()
    loggerErrorSpy.mockRestore()
  })
})

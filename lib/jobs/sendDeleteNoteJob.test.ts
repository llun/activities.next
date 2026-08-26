import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { deleteStatus } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { JOBS } from '@/lib/jobs'
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

// Spy on the sender while keeping its real behaviour: the delivery assertions
// below read the actual signed POSTs, but the per-inbox isolation case needs a
// seam that can reject. postActivityToInbox swallows every network error, so
// failing the socket (as an earlier version of that test did) never reaches the
// job's own guard and proves nothing.
vi.mock('@/lib/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/activities')>()
  return { ...actual, deleteStatus: vi.fn(actual.deleteStatus) }
})

const FOLLOWERS_SHARED_INBOX = 'https://somewhere.test/inbox'

const getRequestBody = (inbox: string) => {
  const call = fetchMock.mock.calls.find((entry) => entry[0] === inbox)
  if (!call) fail(`${inbox} request must exist`)
  return JSON.parse(call[1]?.body as string)
}

describe('sendDeleteNoteJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | null = null
  let realDeleteStatus: typeof deleteStatus

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    const actual =
      await vi.importActual<typeof import('@/lib/activities')>(
        '@/lib/activities'
      )
    realDeleteStatus = actual.deleteStatus
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    // Restore the real sender: vi.clearAllMocks() drops call history but keeps
    // whatever implementation a previous test installed.
    vi.mocked(deleteStatus).mockImplementation(realDeleteStatus)
  })

  it('is registered under its job name', () => {
    expect(JOBS[SEND_DELETE_NOTE_JOB_NAME]).toBe(sendDeleteNoteJob)
  })

  // Every delivery case below deliberately uses a statusId that is not in the
  // database: the row is always gone by the time this job runs.
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

  it('addresses a non-direct delete to the public audience rather than the original recipients', async () => {
    if (!actor1) fail('Actor1 is required')
    const statusId = `${actor1.id}/statuses/followers-only-deleted`

    // Followers-only: the payload's `to` is the followers collection, so a
    // dropped isDirect branch would leak it (and the raw cc) to every shared
    // inbox and relay instead of sending the Public default.
    await sendDeleteNoteJob(database, {
      id: 'job-id',
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId,
        to: [ACTOR1_FOLLOWER_URL],
        cc: []
      }
    })

    const body = getRequestBody(FOLLOWERS_SHARED_INBOX)
    expect(body.to).toEqual([ACTIVITY_STREAM_PUBLIC])
    expect(body.cc).toBeUndefined()
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
      (entry) => entry[0] === FOLLOWERS_SHARED_INBOX
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

  it('keeps delivering to the other inboxes when one send rejects', async () => {
    if (!actor1) fail('Actor1 is required')
    const statusId = `${actor1.id}/statuses/partial-failure`
    vi.mocked(deleteStatus).mockImplementation(async (params) => {
      if (params.inbox === FOLLOWERS_SHARED_INBOX) {
        throw new Error('Inbox unreachable')
      }
      return realDeleteStatus(params)
    })

    // Without the per-inbox guard the rejection escapes Promise.all and
    // withSpan rethrows it, so resolving is itself the assertion.
    await expect(
      sendDeleteNoteJob(database, {
        id: 'job-id',
        name: SEND_DELETE_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId,
          to: [ACTIVITY_STREAM_PUBLIC, EXTERNAL_ACTOR1],
          cc: [ACTOR1_FOLLOWER_URL]
        }
      })
    ).resolves.toBeUndefined()

    expect(vi.mocked(deleteStatus)).toHaveBeenCalledWith(
      expect.objectContaining({ inbox: FOLLOWERS_SHARED_INBOX })
    )
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

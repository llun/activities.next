import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { JOBS } from '@/lib/jobs'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { sendUndoAnnounceJob } from '@/lib/jobs/sendUndoAnnounceJob'
import { expectCall, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_FOLLOWER_URL, seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

enableFetchMocks()

const FOLLOWERS_SHARED_INBOX = 'https://somewhere.test/inbox'

describe('sendUndoAnnounceJob', () => {
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

  it('is registered under its job name', () => {
    expect(JOBS[SEND_UNDO_ANNOUNCE_JOB_NAME]).toBe(sendUndoAnnounceJob)
  })

  // The Announce row is ALWAYS gone by the time this job runs - userUndoAnnounce
  // hard-deletes it before publishing - so the ids below are deliberately absent
  // from the database. Seeding the announce here (as this test used to) makes
  // the job pass against code that always fails in production.
  it('sends the undo for an announce that no longer exists', async () => {
    if (!actor1) fail('Actor1 is required')
    const announceId = `${actor1.id}/statuses/announce-already-deleted`
    const originalStatusId = 'https://somewhere.test/actors/friend/statuses/1'
    const createdAt = 1700000000000

    await sendUndoAnnounceJob(database, {
      id: 'job-id',
      name: SEND_UNDO_ANNOUNCE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId: announceId,
        originalStatusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR1_FOLLOWER_URL],
        createdAt
      }
    })

    expectCall(fetchMock, FOLLOWERS_SHARED_INBOX, 'POST', {
      id: `${announceId}#undo`,
      type: 'Undo',
      actor: actor1.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      object: {
        id: `${announceId}/activity`,
        type: 'Announce',
        actor: actor1.id,
        published: getISOTimeUTC(createdAt),
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR1_FOLLOWER_URL],
        object: originalStatusId
      }
    })
  })

  it('does nothing if actor is not found', async () => {
    // Asserting "no fetch" alone proves nothing here: an unknown actor has no
    // followers either, so the fan-out would be empty with or without the
    // guard. Watch the call the guard is there to prevent instead.
    const followersSpy = vi.spyOn(database, 'getFollowersInbox')

    await sendUndoAnnounceJob(database, {
      id: 'job-id',
      name: SEND_UNDO_ANNOUNCE_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/not-exist-actor',
        statusId: 'https://llun.test/users/not-exist-actor/statuses/announce-1',
        originalStatusId: 'https://somewhere.test/actors/friend/statuses/1',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt: 1700000000000
      }
    })

    expect(followersSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    followersSpy.mockRestore()
  })

  it('rejects a payload missing the announce data it can no longer look up', async () => {
    if (!actor1) fail('Actor1 is required')

    // The pre-fix payload shape. It must fail loudly rather than federate an
    // Undo with an undefined boosted status.
    await expect(
      sendUndoAnnounceJob(database, {
        id: 'job-id',
        name: SEND_UNDO_ANNOUNCE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: `${actor1.id}/statuses/announce-legacy`
        }
      })
    ).rejects.toThrow()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

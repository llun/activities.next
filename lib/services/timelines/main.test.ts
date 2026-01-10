import { randomBytes } from 'crypto'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { ACTOR5_ID } from '@/lib/stub/seed/actor5'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { mainTimelineRule } from './main'
import { Timeline } from './types'

const createStatus = async (
  database: Database,
  actorId: string,
  text: string,
  reply?: string
) => {
  const id = randomBytes(16).toString('hex')
  const status = await database.createNote({
    id: `${actorId}/statuses/${id}`,
    url: `${actorId}/statuses/${id}`,
    actorId,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [`${actorId}/followers`],
    reply,
    text
  })
  return status
}

const createAnnounce = async (
  database: Database,
  actorId: string,
  originalStatusId: string
) => {
  const id = randomBytes(16).toString('hex')
  const status = await database.createAnnounce({
    actorId,
    cc: [`${actorId}/followers`],
    to: [ACTIVITY_STREAM_PUBLIC],
    id: `${actorId}/statuses/${id}/activity`,
    originalStatusId
  })
  return status
}

describe('#mainTimelineRule', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns main timeline name for the currentActor status', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createStatus(
      database,
      ACTOR3_ID,
      'This is self status'
    )
    expect(
      await mainTimelineRule({ database, currentActor: actor, status })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null for the non-following actor', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = (await database.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-1`
    })) as Status
    expect(
      await mainTimelineRule({
        database,
        currentActor: actor,
        status
      })
    ).toBeNull()
  })

  it('returns main timeline for following actor status', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createStatus(
      database,
      ACTOR2_ID,
      'This is following status'
    )
    expect(
      await mainTimelineRule({ database, currentActor: actor, status })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null when following actor status reply to non-following status', async () => {
    const nonFollowingStatus = await createStatus(
      database,
      ACTOR1_ID,
      'This is from non-following actor status'
    )
    const followingStatus = await createStatus(
      database,
      ACTOR2_ID,
      'This is reply to non-following-status',
      nonFollowingStatus.id
    )
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: followingStatus
      })
    ).toBeNull()
  })

  it('returns null when following actor status reply to following status that replies to non-following status', async () => {
    const nonFollowingStatus = await createStatus(
      database,
      ACTOR1_ID,
      'This is non-following status'
    )
    const followingStatusReplyToNonFollowingStatus = await createStatus(
      database,
      ACTOR2_ID,
      'First status that reply to non-following status',
      nonFollowingStatus.id
    )
    const anotherFollowinReplyToSubStatus = await createStatus(
      database,
      ACTOR4_ID,
      'Second status that reply to following status',
      followingStatusReplyToNonFollowingStatus.id
    )

    const actor3 = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    expect(
      await mainTimelineRule({
        database,
        currentActor: actor3,
        status: anotherFollowinReplyToSubStatus
      })
    ).toBeNull()
  })

  it('returns main timeline for the reply to current actor status', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const status = await createStatus(
      database,
      ACTOR3_ID,
      'This is self status'
    )
    const nonFollowingStatus = await createStatus(
      database,
      ACTOR1_ID,
      'Non-following reply to self status',
      status.id
    )

    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: nonFollowingStatus
      })
    ).toEqual(Timeline.MAIN)
  })

  it('returns main timeline for the following actor reply that reply to non-following that reply to self', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const status = await createStatus(
      database,
      ACTOR3_ID,
      'This is self status'
    )
    const nonFollowingReply = await createStatus(
      database,
      ACTOR1_ID,
      'Reply to self status by non-followng',
      status.id
    )
    const followingReplyToNonFollowing = await createStatus(
      database,
      ACTOR2_ID,
      'Reply to non-following that reply to self',
      nonFollowingReply.id
    )

    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: followingReplyToNonFollowing
      })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null for the non-following actor reply that following that reply to non-following that reply to self', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const status = await createStatus(
      database,
      ACTOR3_ID,
      'This is self status'
    )
    const nonFollowingReply = await createStatus(
      database,
      ACTOR1_ID,
      'Reply to self status by non-followng',
      status.id
    )
    const followingReplyToNonFollowing = await createStatus(
      database,
      ACTOR2_ID,
      'Reply to non-following that reply to self',
      nonFollowingReply.id
    )
    const anotherNonFollowingReply = await createStatus(
      database,
      ACTOR5_ID,
      'Another non-following reply to following',
      followingReplyToNonFollowing.id
    )

    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: anotherNonFollowingReply
      })
    ).toBeNull()
  })

  it('returns main timeline for announce from following', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const status = await createAnnounce(
      database,
      ACTOR2_ID,
      `${ACTOR1_ID}/statuses/post-1`
    )
    if (!status) fail('Status must be defined')
    expect(await mainTimelineRule({ database, currentActor, status })).toEqual(
      Timeline.MAIN
    )
  })

  it('returns null for announce that from non-following', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const status = await createAnnounce(
      database,
      ACTOR5_ID,
      `${ACTOR1_ID}/statuses/post-1`
    )
    if (!status) fail('Status must be defined')
    expect(
      await mainTimelineRule({ database, currentActor, status })
    ).toBeNull()
  })

  it('returns null for announce that already in timeline', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const originalStatus = await createStatus(
      database,
      ACTOR3_ID,
      'This is original status'
    )
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: originalStatus
      })
    ).toEqual(Timeline.MAIN)

    const followingAnnounce = await createAnnounce(
      database,
      ACTOR2_ID,
      originalStatus.id
    )
    if (!followingAnnounce) fail('Status must be defined')
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: followingAnnounce
      })
    ).toBeNull()
  })
})

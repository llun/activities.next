import { randomBytes } from 'crypto'

import { getSQLDatabase } from '@/lib/database/sql'
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
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'

import { mainTimelineRule } from './main'
import { Timeline } from './types'

const createStatus = async (
  storage: Database,
  actorId: string,
  text: string,
  reply?: string
) => {
  const id = randomBytes(16).toString('hex')
  const status = await storage.createNote({
    id: `${actorId}/statuses/${id}`,
    url: `${actorId}/statuses/${id}`,
    actorId,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [`${actorId}/followers`],
    reply,
    text
  })
  return status.data
}

const createAnnounce = async (
  storage: Database,
  actorId: string,
  originalStatusId: string
) => {
  const id = randomBytes(16).toString('hex')
  const status = await storage.createAnnounce({
    actorId,
    cc: [`${actorId}/followers`],
    to: [ACTIVITY_STREAM_PUBLIC],
    id: `${actorId}/statuses/${id}/activity`,
    originalStatusId
  })
  return status?.data
}

describe('#mainTimelineRule', () => {
  const storage = getSQLDatabase({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })

  beforeAll(async () => {
    await storage.migrate()
    await seedDatabase(storage)
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns main timeline name for the currentActor status', async () => {
    const actor = (await storage.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createStatus(storage, ACTOR3_ID, 'This is self status')
    expect(
      await mainTimelineRule({ storage, currentActor: actor, status })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null for the non-following actor', async () => {
    const actor = (await storage.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = (await storage.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-1`
    })) as Status
    expect(
      await mainTimelineRule({
        storage,
        currentActor: actor,
        status: status.data
      })
    ).toBeNull()
  })

  it('returns main timeline for following actor status', async () => {
    const actor = (await storage.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createStatus(
      storage,
      ACTOR2_ID,
      'This is following status'
    )
    expect(
      await mainTimelineRule({ storage, currentActor: actor, status })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null when following actor status reply to non-following status', async () => {
    const nonFollowingStatus = await createStatus(
      storage,
      ACTOR1_ID,
      'This is from non-following actor status'
    )
    const followingStatus = await createStatus(
      storage,
      ACTOR2_ID,
      'This is reply to non-following-status',
      nonFollowingStatus.id
    )
    const currentActor = (await storage.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    expect(
      await mainTimelineRule({ storage, currentActor, status: followingStatus })
    ).toBeNull()
  })

  it('returns null when following actor status reply to following status that replies to non-following status', async () => {
    const nonFollowingStatus = await createStatus(
      storage,
      ACTOR1_ID,
      'This is non-following status'
    )
    const followingStatusReplyToNonFollowingStatus = await createStatus(
      storage,
      ACTOR2_ID,
      'First status that reply to non-following status',
      nonFollowingStatus.id
    )
    const anotherFollowinReplyToSubStatus = await createStatus(
      storage,
      ACTOR4_ID,
      'Second status that reply to following status',
      followingStatusReplyToNonFollowingStatus.id
    )

    const actor3 = (await storage.getActorFromId({ id: ACTOR3_ID })) as Actor
    expect(
      await mainTimelineRule({
        storage,
        currentActor: actor3,
        status: anotherFollowinReplyToSubStatus
      })
    ).toBeNull()
  })

  it('returns main timeline for the reply to current actor status', async () => {
    const currentActor = (await storage.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const status = await createStatus(storage, ACTOR3_ID, 'This is self status')
    const nonFollowingStatus = await createStatus(
      storage,
      ACTOR1_ID,
      'Non-following reply to self status',
      status.id
    )

    expect(
      await mainTimelineRule({
        storage,
        currentActor,
        status: nonFollowingStatus
      })
    ).toEqual(Timeline.MAIN)
  })

  it('returns main timeline for the following actor reply that reply to non-following that reply to self', async () => {
    const currentActor = (await storage.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const status = await createStatus(storage, ACTOR3_ID, 'This is self status')
    const nonFollowingReply = await createStatus(
      storage,
      ACTOR1_ID,
      'Reply to self status by non-followng',
      status.id
    )
    const followingReplyToNonFollowing = await createStatus(
      storage,
      ACTOR2_ID,
      'Reply to non-following that reply to self',
      nonFollowingReply.id
    )

    expect(
      await mainTimelineRule({
        storage,
        currentActor,
        status: followingReplyToNonFollowing
      })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null for the non-following actor reply that following that reply to non-following that reply to self', async () => {
    const currentActor = (await storage.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const status = await createStatus(storage, ACTOR3_ID, 'This is self status')
    const nonFollowingReply = await createStatus(
      storage,
      ACTOR1_ID,
      'Reply to self status by non-followng',
      status.id
    )
    const followingReplyToNonFollowing = await createStatus(
      storage,
      ACTOR2_ID,
      'Reply to non-following that reply to self',
      nonFollowingReply.id
    )
    const anotherNonFollowingReply = await createStatus(
      storage,
      ACTOR5_ID,
      'Another non-following reply to following',
      followingReplyToNonFollowing.id
    )

    expect(
      await mainTimelineRule({
        storage,
        currentActor,
        status: anotherNonFollowingReply
      })
    ).toBeNull()
  })

  it('returns main timeline for announce from following', async () => {
    const currentActor = (await storage.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const status = await createAnnounce(
      storage,
      ACTOR2_ID,
      `${ACTOR1_ID}/statuses/post-1`
    )
    if (!status) fail('Status must be defined')
    expect(await mainTimelineRule({ storage, currentActor, status })).toEqual(
      Timeline.MAIN
    )
  })

  it('returns null for announce that from non-following', async () => {
    const currentActor = (await storage.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const status = await createAnnounce(
      storage,
      ACTOR5_ID,
      `${ACTOR1_ID}/statuses/post-1`
    )
    if (!status) fail('Status must be defined')
    expect(await mainTimelineRule({ storage, currentActor, status })).toBeNull()
  })

  it('returns null for announce that already in timeline', async () => {
    const currentActor = (await storage.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const originalStatus = await createStatus(
      storage,
      ACTOR3_ID,
      'This is original status'
    )
    expect(
      await mainTimelineRule({ storage, currentActor, status: originalStatus })
    ).toEqual(Timeline.MAIN)

    const followingAnnounce = await createAnnounce(
      storage,
      ACTOR2_ID,
      originalStatus.id
    )
    if (!followingAnnounce) fail('Status must be defined')
    expect(
      await mainTimelineRule({
        storage,
        currentActor,
        status: followingAnnounce
      })
    ).toBeNull()
  })
})

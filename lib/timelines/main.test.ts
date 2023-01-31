import { randomBytes } from 'crypto'

import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { Status } from '../models/status'
import { Sqlite3Storage } from '../storage/sqlite3'
import { Storage } from '../storage/types'
import { mockRequests } from '../stub/activities'
import { ACTOR1_ID } from '../stub/seed/actor1'
import { ACTOR2_ID } from '../stub/seed/actor2'
import { ACTOR3_ID } from '../stub/seed/actor3'
import { ACTOR4_ID } from '../stub/seed/actor4'
import { ACTOR5_ID } from '../stub/seed/actor5'
import { seedStorage } from '../stub/storage'
import { mainTimelineRule } from './main'
import { Timeline } from './types'

const createStatus = async (
  storage: Storage,
  actorId: string,
  text: string,
  reply?: string
) => {
  const id = randomBytes(16).toString('hex')
  return storage.createNote({
    id: `${actorId}/statuses/${id}`,
    url: `${actorId}/statuses/${id}`,
    actorId,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [`${actorId}/followers`],
    reply,
    text
  })
}

const createAnnounce = async (
  storage: Storage,
  actorId: string,
  originalStatusId: string
) => {
  const id = randomBytes(16).toString('hex')
  return storage.createAnnounce({
    actorId,
    cc: [`${actorId}/followers`],
    to: [ACTIVITY_STREAM_PUBLIC],
    id: `${actorId}/statuses/${id}/activity`,
    originalStatusId
  })
}

describe('#mainTimelineRule', () => {
  const storage = new Sqlite3Storage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
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
      await mainTimelineRule({ storage, currentActor: actor, status })
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
    expect(await mainTimelineRule({ storage, currentActor, status })).toBeNull()
  })
})

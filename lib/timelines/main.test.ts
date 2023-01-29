import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { Status } from '../models/status'
import { Sqlite3Storage } from '../storage/sqlite3'
import { mockRequests } from '../stub/activities'
import { ACTOR1_ID } from '../stub/seed/actor1'
import { ACTOR2_ID } from '../stub/seed/actor2'
import { ACTOR3_ID } from '../stub/seed/actor3'
import { ACTOR4_ID } from '../stub/seed/actor4'
import { seedStorage } from '../stub/storage'
import { mainTimelineRule } from './main'
import { Timeline } from './types'

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
    const status = await storage.createNote({
      id: `${ACTOR3_ID}/statuses/post-1`,
      url: `${ACTOR3_ID}/statuses/post-1`,
      actorId: ACTOR3_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [actor.followersUrl],
      text: 'This is self status'
    })
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
    const followingActor = (await storage.getActorFromId({
      id: ACTOR2_ID
    })) as Actor
    const status = await storage.createNote({
      id: `${ACTOR2_ID}/statuses/to-followers`,
      url: `${ACTOR2_ID}/statuses/to-followers`,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [followingActor.followersUrl],
      text: 'This is for following status'
    })
    expect(
      await mainTimelineRule({ storage, currentActor: actor, status })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null when following actor status reply to non-following status', async () => {
    const nonFollowingActor = (await storage.getActorFromId({
      id: ACTOR1_ID
    })) as Actor
    const nonFollowingStatus = await storage.createNote({
      id: `${ACTOR1_ID}/statuses/non-following-status`,
      url: `${ACTOR1_ID}/statuses/non-following-status`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [nonFollowingActor.followersUrl],
      text: 'This is from non-following actor status'
    })

    const followingActor = (await storage.getActorFromId({
      id: ACTOR2_ID
    })) as Actor
    const followingStatus = await storage.createNote({
      id: `${ACTOR2_ID}/statuses/non-following-reply-status`,
      url: `${ACTOR2_ID}/statuses/non-following-reply-status`,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [followingActor.followersUrl],
      reply: nonFollowingStatus.id,
      text: 'This is reply to non-following status'
    })

    const currentActor = (await storage.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    expect(
      await mainTimelineRule({ storage, currentActor, status: followingStatus })
    ).toBeNull()
  })

  it('returns null when following actor status reply to following status that replies to non-following status', async () => {
    const nonFollowingActor = (await storage.getActorFromId({
      id: ACTOR1_ID
    })) as Actor
    const nonFollowingStatus = await storage.createNote({
      id: `${ACTOR1_ID}/statuses/non-following-status-with-reply-from-following`,
      url: `${ACTOR1_ID}/statuses/non-following-status-with-reply-from-following`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [nonFollowingActor.followersUrl],
      text: 'This is from non-following actor status with reply from following'
    })

    const actor2 = (await storage.getActorFromId({ id: ACTOR2_ID })) as Actor
    const actor2Status = await storage.createNote({
      id: `${ACTOR2_ID}/statuses/first-reply-to-non-following`,
      url: `${ACTOR2_ID}/statuses/first-reply-to-non-following`,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [actor2.followersUrl],
      text: 'First status that reply to non-following status',
      reply: nonFollowingStatus.id
    })

    const actor4 = (await storage.getActorFromId({ id: ACTOR4_ID })) as Actor
    const actor4Status = await storage.createNote({
      id: `${ACTOR4_ID}/statuses/first-reply-to-non-following`,
      url: `${ACTOR4_ID}/statuses/first-reply-to-non-following`,
      actorId: ACTOR4_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [actor4.followersUrl],
      text: 'Second status that reply to following status',
      reply: actor2Status.id
    })

    const actor3 = (await storage.getActorFromId({ id: ACTOR3_ID })) as Actor
    expect(
      await mainTimelineRule({
        storage,
        currentActor: actor3,
        status: actor4Status
      })
    ).toBeNull()
  })

  it('returns main timeline for the reply to current actor status', async () => {
    const actor3 = (await storage.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await storage.createNote({
      id: `${ACTOR3_ID}/statuses/post-2`,
      url: `${ACTOR3_ID}/statuses/post-2`,
      actorId: ACTOR3_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [actor3.followersUrl],
      text: 'This is self status'
    })

    const actor1 = (await storage.getActorFromId({ id: ACTOR1_ID })) as Actor
    const nonFollowingReplyStatus = await storage.createNote({
      id: `${ACTOR1_ID}/statuses/reply-to-self-status-from-non-following`,
      url: `${ACTOR1_ID}/statuses/reply-to-self-status-from-non-following`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [actor1.followersUrl],
      text: 'Reply to self status by non-following',
      reply: status.id
    })

    expect(
      await mainTimelineRule({
        storage,
        currentActor: actor3,
        status: nonFollowingReplyStatus
      })
    ).toEqual(Timeline.MAIN)
  })
})

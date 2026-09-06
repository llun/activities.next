import { randomBytes } from 'crypto'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { ACTOR5_ID } from '@/lib/stub/seed/actor5'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
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

const createCustomStatus = async (
  database: Database,
  actorId: string,
  text: string,
  options?: {
    to?: string[]
    cc?: string[]
    reply?: string
  }
) => {
  const id = randomBytes(16).toString('hex')
  const status = await database.createNote({
    id: `${actorId}/statuses/${id}`,
    url: `${actorId}/statuses/${id}`,
    actorId,
    to: options?.to ?? [ACTIVITY_STREAM_PUBLIC],
    cc: options?.cc ?? [`${actorId}/followers`],
    reply: options?.reply,
    text
  })
  return status
}

const createCustomAnnounce = async (
  database: Database,
  actorId: string,
  originalStatusId: string,
  options?: {
    to?: string[]
    cc?: string[]
  }
) => {
  const id = randomBytes(16).toString('hex')
  const status = await database.createAnnounce({
    actorId,
    to: options?.to ?? [ACTIVITY_STREAM_PUBLIC],
    cc: options?.cc ?? [`${actorId}/followers`],
    id: `${actorId}/statuses/${id}/activity`,
    originalStatusId
  })
  return status
}

describe('mainTimelineRule', () => {
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

  it('returns main timeline for the viewer own announce (self-boost)', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    // A self-boost: the viewer is the booster and does not follow themselves.
    const status = await createAnnounce(
      database,
      ACTOR3_ID,
      `${ACTOR1_ID}/statuses/post-1`
    )
    if (!status) fail('Status must be defined')
    expect(await mainTimelineRule({ database, currentActor, status })).toEqual(
      Timeline.MAIN
    )
  })

  it('returns null for announce from a following the viewer set reblogs=false on', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    // Actor3 follows Actor4 (accepted); disable boosts from Actor4.
    await database.updateFollowPreferences({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR4_ID,
      reblogs: false
    })
    try {
      const status = await createAnnounce(
        database,
        ACTOR4_ID,
        `${ACTOR1_ID}/statuses/post-1`
      )
      if (!status) fail('Status must be defined')
      expect(
        await mainTimelineRule({ database, currentActor, status })
      ).toBeNull()
    } finally {
      await database.updateFollowPreferences({
        actorId: ACTOR3_ID,
        targetActorId: ACTOR4_ID,
        reblogs: true
      })
    }
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

  it('returns null when parent status does not exist (deleted parent)', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const nonExistentParentId = `${ACTOR2_ID}/statuses/this-status-was-deleted`
    const followingReply = await createStatus(
      database,
      ACTOR2_ID,
      'Reply to a deleted parent status',
      nonExistentParentId
    )
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: followingReply
      })
    ).toBeNull()
  })

  it('returns main timeline for following reply to another following actor status', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const followingStatus = await createStatus(
      database,
      ACTOR2_ID,
      'Following actor root status'
    )
    const anotherFollowingReply = await createStatus(
      database,
      ACTOR4_ID,
      'Another following actor reply to following root',
      followingStatus.id
    )
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: anotherFollowingReply
      })
    ).toEqual(Timeline.MAIN)
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

  it('returns null for announce of an unauthorized followers-only status', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const privateStatus = await createCustomStatus(
      database,
      ACTOR1_ID,
      'Private status for Actor1 followers',
      { to: [`${ACTOR1_ID}/followers`], cc: [] }
    )
    const announce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      privateStatus.id
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({ database, currentActor, status: announce })
    ).toBeNull()
  })

  it('returns null for announce of an unauthorized direct status', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const directStatus = await createCustomStatus(
      database,
      ACTOR1_ID,
      'Direct note for Actor2 only',
      { to: [ACTOR2_ID], cc: [] }
    )
    const announce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      directStatus.id
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({ database, currentActor, status: announce })
    ).toBeNull()
  })

  it('returns main timeline for announce of an authorized followers-only status', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const nonFollowedRoot = await createStatus(
      database,
      ACTOR1_ID,
      'Non-followed root'
    )
    const authorizedFollowersStatus = await createCustomStatus(
      database,
      ACTOR4_ID,
      'Followers-only reply to non-followed actor',
      {
        to: [`${ACTOR4_ID}/followers`],
        cc: [],
        reply: nonFollowedRoot.id
      }
    )
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: authorizedFollowersStatus
      })
    ).toBeNull()

    const announce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      authorizedFollowersStatus.id
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({ database, currentActor, status: announce })
    ).toEqual(Timeline.MAIN)
  })

  it('returns main timeline for announce of an authorized direct status', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const authorizedDirectStatus = await createCustomStatus(
      database,
      ACTOR1_ID,
      'Direct note addressed to Actor2 and Actor3',
      { to: [ACTOR2_ID, ACTOR3_ID], cc: [] }
    )
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: authorizedDirectStatus
      })
    ).toBeNull()

    const announce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      authorizedDirectStatus.id
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({ database, currentActor, status: announce })
    ).toEqual(Timeline.MAIN)
  })

  it('returns main timeline for announce of an unlisted status from non-followed actor', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const unlistedStatus = await createCustomStatus(
      database,
      ACTOR1_ID,
      'Unlisted status from non-followed actor',
      { to: [`${ACTOR1_ID}/followers`], cc: [ACTIVITY_STREAM_PUBLIC] }
    )
    const announce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      unlistedStatus.id
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({ database, currentActor, status: announce })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null for announce of an unlisted status from a followed actor (already in timeline)', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const unlistedStatus = await createCustomStatus(
      database,
      ACTOR4_ID,
      'Unlisted status from followed actor',
      { to: [`${ACTOR4_ID}/followers`], cc: [ACTIVITY_STREAM_PUBLIC] }
    )
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: unlistedStatus
      })
    ).toEqual(Timeline.MAIN)

    const announce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      unlistedStatus.id
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({ database, currentActor, status: announce })
    ).toBeNull()
  })

  it('returns null for self-boost of a status already in timeline (own status)', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const selfStatus = await createStatus(database, ACTOR3_ID, 'My own status')
    const selfAnnounce = await createCustomAnnounce(
      database,
      ACTOR3_ID,
      selfStatus.id
    )
    if (!selfAnnounce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: selfAnnounce
      })
    ).toBeNull()
  })

  it('returns null for self-boost of an unauthorized private status', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const privateStatus = await createCustomStatus(
      database,
      ACTOR1_ID,
      'Private status Actor3 cannot read',
      { to: [`${ACTOR1_ID}/followers`], cc: [] }
    )
    const selfAnnounce = await createCustomAnnounce(
      database,
      ACTOR3_ID,
      privateStatus.id
    )
    if (!selfAnnounce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: selfAnnounce
      })
    ).toBeNull()
  })

  it('returns null for nested announce of an unauthorized private original', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const privateStatus = await createCustomStatus(
      database,
      ACTOR1_ID,
      'Private note for nested announce test',
      { to: [`${ACTOR1_ID}/followers`], cc: [] }
    )
    const innerAnnounce = await createCustomAnnounce(
      database,
      ACTOR5_ID,
      privateStatus.id
    )
    if (!innerAnnounce) fail('Inner announce must be defined')

    const outerAnnounce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      innerAnnounce.id
    )
    if (!outerAnnounce) fail('Outer announce must be defined')

    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: outerAnnounce
      })
    ).toBeNull()
  })

  it('returns main timeline for nested announce of an authorized status not in timeline', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const publicStatus = await createStatus(
      database,
      ACTOR1_ID,
      'Public note for nested announce test'
    )
    const innerAnnounce = await createCustomAnnounce(
      database,
      ACTOR5_ID,
      publicStatus.id
    )
    if (!innerAnnounce) fail('Inner announce must be defined')

    const outerAnnounce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      innerAnnounce.id
    )
    if (!outerAnnounce) fail('Outer announce must be defined')

    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: outerAnnounce
      })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null for nested announce when root original is already in timeline', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const rootStatus = await createStatus(
      database,
      ACTOR4_ID,
      'Root note followed by Actor3'
    )
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: rootStatus
      })
    ).toEqual(Timeline.MAIN)

    const innerAnnounce = await createCustomAnnounce(
      database,
      ACTOR5_ID,
      rootStatus.id
    )
    if (!innerAnnounce) fail('Inner announce must be defined')

    const outerAnnounce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      innerAnnounce.id
    )
    if (!outerAnnounce) fail('Outer announce must be defined')

    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: outerAnnounce
      })
    ).toBeNull()
  })

  it('returns null for announce when original status is independently selected in timeline', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const originalStatus = await createStatus(
      database,
      ACTOR2_ID,
      'Independently selected original status'
    )
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: originalStatus
      })
    ).toEqual(Timeline.MAIN)

    const announce = await createCustomAnnounce(
      database,
      ACTOR4_ID,
      originalStatus.id
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: announce
      })
    ).toBeNull()
  })

  it('returns null for announce when announce wrapper is direct to another actor (unreadable wrapper)', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const publicStatus = await createStatus(
      database,
      ACTOR1_ID,
      'Public note with direct announce wrapper'
    )
    const announce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      publicStatus.id,
      { to: [ACTOR1_ID], cc: [] }
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({ database, currentActor, status: announce })
    ).toBeNull()
  })

  it('returns null for nested announce when inner announce wrapper is unauthorized', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const publicStatus = await createStatus(
      database,
      ACTOR1_ID,
      'Public note for nested announce with unauthorized inner wrapper'
    )
    const innerAnnounce = await createCustomAnnounce(
      database,
      ACTOR5_ID,
      publicStatus.id,
      { to: [ACTOR1_ID], cc: [] }
    )
    if (!innerAnnounce) fail('Inner announce must be defined')

    const outerAnnounce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      innerAnnounce.id
    )
    if (!outerAnnounce) fail('Outer announce must be defined')

    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: outerAnnounce
      })
    ).toBeNull()
  })

  it('returns main timeline for authorized followers-only announce wrapper of a public status', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const publicStatus = await createStatus(
      database,
      ACTOR1_ID,
      'Public note for followers-only announce wrapper'
    )
    const announce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      publicStatus.id,
      { to: [`${ACTOR2_ID}/followers`], cc: [] }
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({ database, currentActor, status: announce })
    ).toEqual(Timeline.MAIN)
  })

  it('returns main timeline for authorized direct announce wrapper of a public status', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const publicStatus = await createStatus(
      database,
      ACTOR1_ID,
      'Public note for direct announce wrapper'
    )
    const announce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      publicStatus.id,
      { to: [ACTOR3_ID], cc: [] }
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await mainTimelineRule({ database, currentActor, status: announce })
    ).toEqual(Timeline.MAIN)
  })

  it('returns null for nested announce when all boosters and original author are followed and root is already in timeline', async () => {
    const currentActor = (await database.getActorFromId({
      id: ACTOR3_ID
    })) as Actor
    const rootStatus = await createStatus(
      database,
      ACTOR4_ID,
      'Root note by followed Actor4'
    )
    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: rootStatus
      })
    ).toEqual(Timeline.MAIN)

    // Actor3 follows Actor2
    const innerAnnounce = await createCustomAnnounce(
      database,
      ACTOR2_ID,
      rootStatus.id
    )
    if (!innerAnnounce) fail('Inner announce must be defined')

    // Actor3 follows Actor4
    const outerAnnounce = await createCustomAnnounce(
      database,
      ACTOR4_ID,
      innerAnnounce.id
    )
    if (!outerAnnounce) fail('Outer announce must be defined')

    expect(
      await mainTimelineRule({
        database,
        currentActor,
        status: outerAnnounce
      })
    ).toBeNull()
  })
})

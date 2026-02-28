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

import { noannounceTimelineRule } from './noaanounce'
import { Timeline } from './types'

const createStatus = async (
  database: Database,
  actorId: string,
  text: string,
  reply?: string
) => {
  const id = randomBytes(16).toString('hex')
  return database.createNote({
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
  database: Database,
  actorId: string,
  originalStatusId: string
) => {
  const id = randomBytes(16).toString('hex')
  return database.createAnnounce({
    actorId,
    cc: [`${actorId}/followers`],
    to: [ACTIVITY_STREAM_PUBLIC],
    id: `${actorId}/statuses/${id}/activity`,
    originalStatusId
  })
}

/**
 * Seed follow relationships for ACTOR3 (currentActor in all tests):
 *   Actor3 follows Actor2
 *   Actor3 follows Actor4
 *   Actor3 does NOT follow Actor1 or Actor5
 */
describe('#noannounceTimelineRule', () => {
  const database = getTestSQLDatabase()
  let currentActor: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    currentActor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns null for announce from following (unlike main timeline which would include it)', async () => {
    const announce = await createAnnounce(
      database,
      ACTOR2_ID,
      `${ACTOR1_ID}/statuses/post-1`
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await noannounceTimelineRule({ database, currentActor, status: announce })
    ).toBeNull()
  })

  it('returns null for announce from non-following', async () => {
    const announce = await createAnnounce(
      database,
      ACTOR5_ID,
      `${ACTOR1_ID}/statuses/post-1`
    )
    if (!announce) fail('Announce must be defined')
    expect(
      await noannounceTimelineRule({ database, currentActor, status: announce })
    ).toBeNull()
  })

  it('returns noannounce timeline for self status', async () => {
    const status = await createStatus(database, ACTOR3_ID, 'Self status')
    expect(
      await noannounceTimelineRule({ database, currentActor, status })
    ).toEqual(Timeline.NOANNOUNCE)
  })

  it('returns null for non-following actor status', async () => {
    const status = (await database.getStatus({
      statusId: `${ACTOR1_ID}/statuses/post-1`
    })) as Status
    expect(
      await noannounceTimelineRule({ database, currentActor, status })
    ).toBeNull()
  })

  it('returns noannounce timeline for following actor status with no reply', async () => {
    const status = await createStatus(
      database,
      ACTOR2_ID,
      'Following actor status'
    )
    expect(
      await noannounceTimelineRule({ database, currentActor, status })
    ).toEqual(Timeline.NOANNOUNCE)
  })

  it('returns null when following actor status replies to non-following status', async () => {
    const nonFollowingStatus = await createStatus(
      database,
      ACTOR1_ID,
      'Non-following root status'
    )
    const followingReply = await createStatus(
      database,
      ACTOR2_ID,
      'Following reply to non-following',
      nonFollowingStatus.id
    )
    expect(
      await noannounceTimelineRule({
        database,
        currentActor,
        status: followingReply
      })
    ).toBeNull()
  })

  it('returns null when following reply chain eventually leads to non-following root', async () => {
    const nonFollowingRoot = await createStatus(
      database,
      ACTOR1_ID,
      'Non-following root'
    )
    const followingReplyToNonFollowing = await createStatus(
      database,
      ACTOR2_ID,
      'Following reply to non-following root',
      nonFollowingRoot.id
    )
    const anotherFollowingReply = await createStatus(
      database,
      ACTOR4_ID,
      'Another following reply further up the chain',
      followingReplyToNonFollowing.id
    )
    expect(
      await noannounceTimelineRule({
        database,
        currentActor,
        status: anotherFollowingReply
      })
    ).toBeNull()
  })

  it('returns noannounce timeline for non-following reply to self status', async () => {
    const selfStatus = await createStatus(
      database,
      ACTOR3_ID,
      'Self status for reply'
    )
    const nonFollowingReply = await createStatus(
      database,
      ACTOR1_ID,
      'Non-following reply to self status',
      selfStatus.id
    )
    expect(
      await noannounceTimelineRule({
        database,
        currentActor,
        status: nonFollowingReply
      })
    ).toEqual(Timeline.NOANNOUNCE)
  })

  it('returns noannounce for following reply to non-following that replied to self', async () => {
    const selfStatus = await createStatus(
      database,
      ACTOR3_ID,
      'Self status root'
    )
    const nonFollowingReply = await createStatus(
      database,
      ACTOR1_ID,
      'Non-following reply to self',
      selfStatus.id
    )
    const followingReply = await createStatus(
      database,
      ACTOR2_ID,
      'Following reply to non-following reply to self',
      nonFollowingReply.id
    )
    expect(
      await noannounceTimelineRule({
        database,
        currentActor,
        status: followingReply
      })
    ).toEqual(Timeline.NOANNOUNCE)
  })

  it('returns null for non-following reply at end of a chain through self', async () => {
    const selfStatus = await createStatus(
      database,
      ACTOR3_ID,
      'Self status for chain'
    )
    const nonFollowingReply = await createStatus(
      database,
      ACTOR1_ID,
      'Non-following reply to self',
      selfStatus.id
    )
    const followingReply = await createStatus(
      database,
      ACTOR2_ID,
      'Following reply to non-following',
      nonFollowingReply.id
    )
    const anotherNonFollowingReply = await createStatus(
      database,
      ACTOR5_ID,
      'Non-following reply at end of chain',
      followingReply.id
    )
    expect(
      await noannounceTimelineRule({
        database,
        currentActor,
        status: anotherNonFollowingReply
      })
    ).toBeNull()
  })

  it('returns null when parent status does not exist (deleted parent)', async () => {
    const nonExistentParentId = `${ACTOR2_ID}/statuses/this-status-does-not-exist`
    const followingReply = await createStatus(
      database,
      ACTOR2_ID,
      'Reply to a deleted status',
      nonExistentParentId
    )
    expect(
      await noannounceTimelineRule({
        database,
        currentActor,
        status: followingReply
      })
    ).toBeNull()
  })

  it('returns noannounce for following reply to another following status', async () => {
    const followingStatus = await createStatus(
      database,
      ACTOR2_ID,
      'Following actor root status'
    )
    const anotherFollowingReply = await createStatus(
      database,
      ACTOR4_ID,
      'Another following actor reply to following status',
      followingStatus.id
    )
    expect(
      await noannounceTimelineRule({
        database,
        currentActor,
        status: anotherFollowingReply
      })
    ).toEqual(Timeline.NOANNOUNCE)
  })
})

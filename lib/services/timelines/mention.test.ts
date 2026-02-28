import { randomBytes } from 'crypto'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { EXTERNAL_ACTOR1, EXTERNAL_ACTOR1_FOLLOWERS } from '@/lib/stub/seed/external1'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor, getActorURL } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { mentionTimelineRule } from './mention'
import { Timeline } from './types'

const createNote = async (
  database: Database,
  actorId: string,
  text: string,
  followersUrl: string
) => {
  const id = randomBytes(16).toString('hex')
  return database.createNote({
    id: `${actorId}/statuses/${id}`,
    url: `${actorId}/statuses/${id}`,
    actorId,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [followersUrl],
    text
  })
}

const createMentionTag = async (
  database: Database,
  statusId: string,
  mentionedActorUrl: string,
  mentionedActorUsername: string
) => {
  return database.createTag({
    statusId,
    name: `@${mentionedActorUsername}`,
    value: mentionedActorUrl,
    type: 'mention'
  })
}

describe('#mentionTimelineRule', () => {
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

  it('returns null for Announce status', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    // ACTOR2 announce is seeded in database.ts
    const status = (await database.getStatus({
      statusId: `${ACTOR2_ID}/statuses/post-3`
    })) as Status
    expect(
      await mentionTimelineRule({ database, currentActor: actor, status })
    ).toBeNull()
  })

  it('returns MENTION timeline for self-post without creating a notification', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    // Self-post returns MENTION early via actorId check — no tag needed
    const status = await createNote(
      database,
      ACTOR3_ID,
      `Self-mention ${getActorURL(actor)}`,
      `${ACTOR3_ID}/followers`
    )

    const result = await mentionTimelineRule({ database, currentActor: actor, status })
    expect(result).toEqual(Timeline.MENTION)

    const notifications = await database.getNotifications({
      actorId: actor.id,
      limit: 100
    })
    expect(notifications.filter((n) => n.statusId === status.id)).toHaveLength(0)
  })

  it('returns null when status has no mention tag for the current actor', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      EXTERNAL_ACTOR1,
      'Hello world, no mention here',
      EXTERNAL_ACTOR1_FOLLOWERS
    )
    // No mention tag created — rule must not trigger on text content alone

    expect(
      await mentionTimelineRule({ database, currentActor: actor, status })
    ).toBeNull()
  })

  it('returns null when status text contains actor URL but has no mention tag', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      EXTERNAL_ACTOR1,
      `Check out this profile: ${getActorURL(actor)}`,
      EXTERNAL_ACTOR1_FOLLOWERS
    )
    // Text contains actor URL but no explicit mention tag — must NOT trigger

    expect(
      await mentionTimelineRule({ database, currentActor: actor, status })
    ).toBeNull()
  })

  it('returns MENTION timeline and creates notification for remote mention', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      EXTERNAL_ACTOR1,
      `Hey ${getActorURL(actor)} hello from remote!`,
      EXTERNAL_ACTOR1_FOLLOWERS
    )
    // Simulate createNoteJob: persist mention tag before timeline rules run
    await createMentionTag(database, status.id, getActorURL(actor), actor.username)

    const result = await mentionTimelineRule({ database, currentActor: actor, status })
    expect(result).toEqual(Timeline.MENTION)

    const notifications = await database.getNotifications({
      actorId: actor.id,
      limit: 100
    })
    const mentionNotif = notifications.find((n) => n.statusId === status.id)
    expect(mentionNotif).toBeDefined()
    expect(mentionNotif?.type).toBe(NotificationType.enum.mention)
    expect(mentionNotif?.sourceActorId).toBe(EXTERNAL_ACTOR1)
  })

  it('returns MENTION timeline and creates notification when tag value matches actor id', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      EXTERNAL_ACTOR1,
      `Hey ${actor.id} hello from remote!`,
      EXTERNAL_ACTOR1_FOLLOWERS
    )
    // Some servers use the ActivityPub actor ID as the mention href
    await createMentionTag(database, status.id, actor.id, actor.username)

    const result = await mentionTimelineRule({ database, currentActor: actor, status })
    expect(result).toEqual(Timeline.MENTION)

    const notifications = await database.getNotifications({
      actorId: actor.id,
      limit: 100
    })
    expect(notifications.find((n) => n.statusId === status.id)).toBeDefined()
  })

  it('returns MENTION timeline but does NOT create notification for local actor mention', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    // ACTOR1 is a local actor — local-to-local notifications are handled by createNote.ts
    const status = await createNote(
      database,
      ACTOR1_ID,
      `Hey ${getActorURL(actor)} hello from local!`,
      `${ACTOR1_ID}/followers`
    )
    // Simulate createNote.ts: persist mention tag before timeline rules run
    await createMentionTag(database, status.id, getActorURL(actor), actor.username)

    const result = await mentionTimelineRule({ database, currentActor: actor, status })
    expect(result).toEqual(Timeline.MENTION)

    const notifications = await database.getNotifications({
      actorId: actor.id,
      limit: 100
    })
    expect(notifications.find((n) => n.statusId === status.id)).toBeUndefined()
  })
})

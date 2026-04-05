import { randomBytes } from 'crypto'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { sendPushNotification } from '@/lib/services/notifications/pushNotification'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import {
  EXTERNAL_ACTOR1,
  EXTERNAL_ACTOR1_FOLLOWERS
} from '@/lib/stub/seed/external1'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor, getActorURL } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { mentionTimelineRule } from './mention'
import { Timeline } from './types'

jest.mock('@/lib/services/notifications/pushNotification', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined)
}))

const mockSendPush = sendPushNotification as jest.MockedFunction<
  typeof sendPushNotification
>

const createNote = async (
  database: Database,
  actorId: string,
  text: string,
  followersUrl: string,
  reply?: string
) => {
  const id = randomBytes(16).toString('hex')
  return database.createNote({
    id: `${actorId}/statuses/${id}`,
    url: `${actorId}/statuses/${id}`,
    actorId,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [followersUrl],
    text,
    reply
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

// Wait for fire-and-forget promise chains (database.getActorFromId → sendPushNotification)
const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve))

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
    mockSendPush.mockClear()
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

    const result = await mentionTimelineRule({
      database,
      currentActor: actor,
      status
    })
    expect(result).toEqual(Timeline.MENTION)

    const notifications = await database.getNotifications({
      actorId: actor.id,
      limit: 100
    })
    expect(notifications.filter((n) => n.statusId === status.id)).toHaveLength(
      0
    )
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
    await createMentionTag(
      database,
      status.id,
      getActorURL(actor),
      actor.username
    )

    const result = await mentionTimelineRule({
      database,
      currentActor: actor,
      status
    })
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

    const result = await mentionTimelineRule({
      database,
      currentActor: actor,
      status
    })
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
    await createMentionTag(
      database,
      status.id,
      getActorURL(actor),
      actor.username
    )

    const result = await mentionTimelineRule({
      database,
      currentActor: actor,
      status
    })
    expect(result).toEqual(Timeline.MENTION)

    const notifications = await database.getNotifications({
      actorId: actor.id,
      limit: 100
    })
    expect(notifications.find((n) => n.statusId === status.id)).toBeUndefined()
  })

  it('sends push notification for remote mention', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      EXTERNAL_ACTOR1,
      `Hey ${getActorURL(actor)} push test!`,
      EXTERNAL_ACTOR1_FOLLOWERS
    )
    await createMentionTag(
      database,
      status.id,
      getActorURL(actor),
      actor.username
    )

    await mentionTimelineRule({ database, currentActor: actor, status })
    await flushPromises()

    expect(mockSendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.id,
        type: NotificationType.enum.mention,
        statusId: status.id
      })
    )
  })

  it('does NOT send push notification for local actor mention', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      ACTOR1_ID,
      `Hey ${getActorURL(actor)} local push test!`,
      `${ACTOR1_ID}/followers`
    )
    await createMentionTag(
      database,
      status.id,
      getActorURL(actor),
      actor.username
    )

    await mentionTimelineRule({ database, currentActor: actor, status })
    await flushPromises()

    expect(mockSendPush).not.toHaveBeenCalled()
  })

  it('creates reply notification and returns MENTION for remote reply to own post', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    // First create a post by the current actor
    const originalPost = await createNote(
      database,
      ACTOR3_ID,
      'My original post',
      `${ACTOR3_ID}/followers`
    )
    // Remote actor replies to it
    const replyStatus = await createNote(
      database,
      EXTERNAL_ACTOR1,
      'Great post!',
      EXTERNAL_ACTOR1_FOLLOWERS,
      originalPost.id
    )

    const result = await mentionTimelineRule({
      database,
      currentActor: actor,
      status: replyStatus
    })
    expect(result).toEqual(Timeline.MENTION)

    const notifications = await database.getNotifications({
      actorId: actor.id,
      limit: 100
    })
    const replyNotif = notifications.find(
      (n) => n.statusId === replyStatus.id && n.type === 'reply'
    )
    expect(replyNotif).toBeDefined()
    expect(replyNotif?.sourceActorId).toBe(EXTERNAL_ACTOR1)
  })

  it('sends push notification for remote reply', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const originalPost = await createNote(
      database,
      ACTOR3_ID,
      'Reply push test post',
      `${ACTOR3_ID}/followers`
    )
    const replyStatus = await createNote(
      database,
      EXTERNAL_ACTOR1,
      'Reply push test!',
      EXTERNAL_ACTOR1_FOLLOWERS,
      originalPost.id
    )

    await mentionTimelineRule({
      database,
      currentActor: actor,
      status: replyStatus
    })
    await flushPromises()

    expect(mockSendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.id,
        type: NotificationType.enum.reply,
        statusId: replyStatus.id
      })
    )
  })

  it('does NOT create reply notification for local actor reply', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const originalPost = await createNote(
      database,
      ACTOR3_ID,
      'Local reply test post',
      `${ACTOR3_ID}/followers`
    )
    // Local actor (ACTOR1) replies — handled by createNote.ts, not here
    const replyStatus = await createNote(
      database,
      ACTOR1_ID,
      'Local reply!',
      `${ACTOR1_ID}/followers`,
      originalPost.id
    )

    const result = await mentionTimelineRule({
      database,
      currentActor: actor,
      status: replyStatus
    })
    // Not mentioned and local reply — should not add to mention timeline
    expect(result).toBeNull()

    const notifications = await database.getNotifications({
      actorId: actor.id,
      limit: 100
    })
    expect(
      notifications.find(
        (n) => n.statusId === replyStatus.id && n.type === 'reply'
      )
    ).toBeUndefined()
  })

  it('sends only reply push when status is both reply and mention', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const originalPost = await createNote(
      database,
      ACTOR3_ID,
      'Dedup test post',
      `${ACTOR3_ID}/followers`
    )
    // Remote actor replies AND mentions
    const replyMentionStatus = await createNote(
      database,
      EXTERNAL_ACTOR1,
      `Hey ${getActorURL(actor)} replying to you!`,
      EXTERNAL_ACTOR1_FOLLOWERS,
      originalPost.id
    )
    await createMentionTag(
      database,
      replyMentionStatus.id,
      getActorURL(actor),
      actor.username
    )

    await mentionTimelineRule({
      database,
      currentActor: actor,
      status: replyMentionStatus
    })
    await flushPromises()

    // Both notifications should be created in DB
    const notifications = await database.getNotifications({
      actorId: actor.id,
      limit: 100
    })
    expect(
      notifications.find(
        (n) => n.statusId === replyMentionStatus.id && n.type === 'reply'
      )
    ).toBeDefined()
    expect(
      notifications.find(
        (n) => n.statusId === replyMentionStatus.id && n.type === 'mention'
      )
    ).toBeDefined()

    // Only one push notification should be sent (reply, not mention)
    expect(mockSendPush).toHaveBeenCalledTimes(1)
    expect(mockSendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.enum.reply
      })
    )
  })

  it('returns null for remote reply to another actor post', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    // Create a post by ACTOR1 (not the current actor)
    const otherPost = await createNote(
      database,
      ACTOR1_ID,
      'Someone else post',
      `${ACTOR1_ID}/followers`
    )
    // Remote actor replies to it
    const replyStatus = await createNote(
      database,
      EXTERNAL_ACTOR1,
      'Reply to someone else',
      EXTERNAL_ACTOR1_FOLLOWERS,
      otherPost.id
    )

    const result = await mentionTimelineRule({
      database,
      currentActor: actor,
      status: replyStatus
    })
    // Not a reply to our post and no mention → null
    expect(result).toBeNull()
  })
})

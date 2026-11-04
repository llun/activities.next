import { randomBytes } from 'crypto'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
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

import {
  hasMentionNotification,
  notifyRemoteMention,
  notifyRemoteReplyAndMention
} from './mentionNotification'

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

const mockSendAlerts = sendNotificationAlerts as jest.MockedFunction<
  typeof sendNotificationAlerts
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

const notificationsForStatus = async (
  database: Database,
  actorId: string,
  statusId: string
) => {
  const notifications = await database.getNotifications({
    actorId,
    limit: 100
  })
  return notifications.filter(
    (notification) => notification.statusId === statusId
  )
}

describe('notifyRemoteReplyAndMention', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
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
    mockSendAlerts.mockClear()
  })

  it('does not notify for an Announce status', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    // ACTOR2 announce is seeded in database.ts
    const status = (await database.getStatus({
      statusId: `${ACTOR2_ID}/statuses/post-3`
    })) as Status

    await notifyRemoteReplyAndMention({ database, currentActor: actor, status })

    expect(
      await notificationsForStatus(database, actor.id, status.id)
    ).toHaveLength(0)
    expect(mockSendAlerts).not.toHaveBeenCalled()
  })

  it('does not notify for a self-post', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    // Self-post returns early via the actorId check — no tag needed
    const status = await createNote(
      database,
      ACTOR3_ID,
      `Self-mention ${getActorURL(actor)}`,
      `${ACTOR3_ID}/followers`
    )

    await notifyRemoteReplyAndMention({ database, currentActor: actor, status })

    expect(
      await notificationsForStatus(database, actor.id, status.id)
    ).toHaveLength(0)
    expect(mockSendAlerts).not.toHaveBeenCalled()
  })

  it('does not notify when status has no mention tag for the current actor', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      EXTERNAL_ACTOR1,
      'Hello world, no mention here',
      EXTERNAL_ACTOR1_FOLLOWERS
    )
    // No mention tag created — rule must not trigger on text content alone

    await notifyRemoteReplyAndMention({ database, currentActor: actor, status })

    expect(
      await notificationsForStatus(database, actor.id, status.id)
    ).toHaveLength(0)
    expect(mockSendAlerts).not.toHaveBeenCalled()
  })

  it('does not notify when status text contains actor URL but has no mention tag', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      EXTERNAL_ACTOR1,
      `Check out this profile: ${getActorURL(actor)}`,
      EXTERNAL_ACTOR1_FOLLOWERS
    )
    // Text contains actor URL but no explicit mention tag — must NOT trigger

    await notifyRemoteReplyAndMention({ database, currentActor: actor, status })

    expect(
      await notificationsForStatus(database, actor.id, status.id)
    ).toHaveLength(0)
    expect(mockSendAlerts).not.toHaveBeenCalled()
  })

  it('creates a notification for a remote mention', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      EXTERNAL_ACTOR1,
      `Hey ${getActorURL(actor)} hello from remote!`,
      EXTERNAL_ACTOR1_FOLLOWERS
    )
    // Simulate createNoteJob: persist mention tag before the rule runs
    await createMentionTag(
      database,
      status.id,
      getActorURL(actor),
      actor.username
    )

    await notifyRemoteReplyAndMention({ database, currentActor: actor, status })

    const mentionNotif = (
      await notificationsForStatus(database, actor.id, status.id)
    )[0]
    expect(mentionNotif).toBeDefined()
    expect(mentionNotif?.type).toBe(NotificationType.enum.mention)
    expect(mentionNotif?.sourceActorId).toBe(EXTERNAL_ACTOR1)
  })

  it('does not notify when a remote mention is blocked', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      EXTERNAL_ACTOR1,
      `Hey ${getActorURL(actor)} blocked remote mention`,
      EXTERNAL_ACTOR1_FOLLOWERS
    )
    await createMentionTag(
      database,
      status.id,
      getActorURL(actor),
      actor.username
    )
    await database.createBlock({
      actorId: actor.id,
      targetActorId: EXTERNAL_ACTOR1,
      uri: `${actor.id}#blocks/remote-mention-${randomBytes(8).toString('hex')}`
    })

    try {
      await notifyRemoteReplyAndMention({
        database,
        currentActor: actor,
        status
      })

      expect(
        await notificationsForStatus(database, actor.id, status.id)
      ).toHaveLength(0)
      expect(mockSendAlerts).not.toHaveBeenCalled()
    } finally {
      await database.deleteBlock({
        actorId: actor.id,
        targetActorId: EXTERNAL_ACTOR1
      })
    }
  })

  it('creates a notification when the tag value matches the actor id', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const status = await createNote(
      database,
      EXTERNAL_ACTOR1,
      `Hey ${actor.id} hello from remote!`,
      EXTERNAL_ACTOR1_FOLLOWERS
    )
    // Some servers use the ActivityPub actor ID as the mention href
    await createMentionTag(database, status.id, actor.id, actor.username)

    await notifyRemoteReplyAndMention({ database, currentActor: actor, status })

    expect(
      await notificationsForStatus(database, actor.id, status.id)
    ).toHaveLength(1)
  })

  it('does NOT create a notification for a local actor mention', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    // ACTOR1 is a local actor — local-to-local notifications are handled by createNote.ts
    const status = await createNote(
      database,
      ACTOR1_ID,
      `Hey ${getActorURL(actor)} hello from local!`,
      `${ACTOR1_ID}/followers`
    )
    // Simulate createNote.ts: persist mention tag before the rule runs
    await createMentionTag(
      database,
      status.id,
      getActorURL(actor),
      actor.username
    )

    await notifyRemoteReplyAndMention({ database, currentActor: actor, status })

    expect(
      await notificationsForStatus(database, actor.id, status.id)
    ).toHaveLength(0)
    expect(mockSendAlerts).not.toHaveBeenCalled()
  })

  it('sends notification alerts for a remote mention', async () => {
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

    await notifyRemoteReplyAndMention({ database, currentActor: actor, status })

    expect(mockSendAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.id,
        sourceActorId: EXTERNAL_ACTOR1,
        statusId: status.id,
        events: [
          expect.objectContaining({ type: NotificationType.enum.mention })
        ]
      })
    )
  })

  it('does NOT send notification alerts for a local actor mention', async () => {
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

    await notifyRemoteReplyAndMention({ database, currentActor: actor, status })

    expect(mockSendAlerts).not.toHaveBeenCalled()
  })

  it('creates a reply notification for a remote reply to own post', async () => {
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

    await notifyRemoteReplyAndMention({
      database,
      currentActor: actor,
      status: replyStatus
    })

    const replyNotif = (
      await notificationsForStatus(database, actor.id, replyStatus.id)
    ).find((n) => n.type === 'reply')
    expect(replyNotif).toBeDefined()
    expect(replyNotif?.sourceActorId).toBe(EXTERNAL_ACTOR1)
  })

  it('does not notify when a remote reply actor is blocked', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const originalPost = await createNote(
      database,
      ACTOR3_ID,
      'Blocked reply original post',
      `${ACTOR3_ID}/followers`
    )
    const replyStatus = await createNote(
      database,
      EXTERNAL_ACTOR1,
      'Blocked reply',
      EXTERNAL_ACTOR1_FOLLOWERS,
      originalPost.id
    )
    await database.createBlock({
      actorId: actor.id,
      targetActorId: EXTERNAL_ACTOR1,
      uri: `${actor.id}#blocks/remote-reply-${randomBytes(8).toString('hex')}`
    })

    try {
      await notifyRemoteReplyAndMention({
        database,
        currentActor: actor,
        status: replyStatus
      })

      expect(
        await notificationsForStatus(database, actor.id, replyStatus.id)
      ).toHaveLength(0)
      expect(mockSendAlerts).not.toHaveBeenCalled()
    } finally {
      await database.deleteBlock({
        actorId: actor.id,
        targetActorId: EXTERNAL_ACTOR1
      })
    }
  })

  it('sends notification alerts for a remote reply', async () => {
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

    await notifyRemoteReplyAndMention({
      database,
      currentActor: actor,
      status: replyStatus
    })

    expect(mockSendAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.id,
        sourceActorId: EXTERNAL_ACTOR1,
        statusId: replyStatus.id,
        events: [expect.objectContaining({ type: NotificationType.enum.reply })]
      })
    )
  })

  it('does NOT create a reply notification for a local actor reply', async () => {
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

    await notifyRemoteReplyAndMention({
      database,
      currentActor: actor,
      status: replyStatus
    })

    expect(
      (await notificationsForStatus(database, actor.id, replyStatus.id)).find(
        (n) => n.type === 'reply'
      )
    ).toBeUndefined()
  })

  it('merges into a single reply notification when status is both reply and mention', async () => {
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

    await notifyRemoteReplyAndMention({
      database,
      currentActor: actor,
      status: replyMentionStatus
    })

    // A reply that also mentions the recipient is a single event: keep only the
    // (more specific) reply notification and suppress the duplicate mention one.
    const forStatus = await notificationsForStatus(
      database,
      actor.id,
      replyMentionStatus.id
    )
    expect(forStatus.find((n) => n.type === 'reply')).toBeDefined()
    expect(forStatus.find((n) => n.type === 'mention')).toBeUndefined()
    expect(forStatus).toHaveLength(1)

    // sendNotificationAlerts called once with a single reply event.
    expect(mockSendAlerts).toHaveBeenCalledTimes(1)
    const { events } = mockSendAlerts.mock.calls[0][0]
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(NotificationType.enum.reply)
  })

  it('carries the reply email on the merged reply event for a remote reply that also mentions the recipient', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    const originalPost = await createNote(
      database,
      ACTOR3_ID,
      'Reply+mention email post',
      `${ACTOR3_ID}/followers`
    )
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

    await notifyRemoteReplyAndMention({
      database,
      currentActor: actor,
      status: replyMentionStatus
    })

    // The reply email must ride on the surviving reply event — the mention
    // branch that used to carry it is skipped once the reply is created, so
    // without this the email channel silently drops for remote reply+mentions.
    expect(mockSendAlerts).toHaveBeenCalledTimes(1)
    const { events } = mockSendAlerts.mock.calls[0][0]
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: NotificationType.enum.reply,
      emailContent: expect.objectContaining({
        recipientEmail: actor.account?.email,
        subject: expect.stringContaining('replied to your post')
      })
    })
  })

  it('keeps a single filtered reply notification and sends no alert when a filtered reply also mentions the recipient', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    await database.updateNotificationPolicy({
      actorId: actor.id,
      for_not_following: 'filter'
    })
    try {
      const originalPost = await createNote(
        database,
        ACTOR3_ID,
        'Filtered reply+mention post',
        `${ACTOR3_ID}/followers`
      )
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

      await notifyRemoteReplyAndMention({
        database,
        currentActor: actor,
        status: replyMentionStatus
      })

      // A filtered reply still collapses to a single (filtered) reply
      // notification with no duplicate mention, and pushes no alert event.
      const notifications = await database.getNotifications({
        actorId: actor.id,
        limit: 100,
        includeFiltered: true
      })
      const forStatus = notifications.filter(
        (n) => n.statusId === replyMentionStatus.id
      )
      expect(forStatus).toHaveLength(1)
      expect(forStatus[0].type).toBe(NotificationType.enum.reply)
      expect(forStatus[0].filtered).toBe(true)
      expect(mockSendAlerts).not.toHaveBeenCalled()
    } finally {
      await database.updateNotificationPolicy({
        actorId: actor.id,
        for_not_following: 'accept'
      })
    }
  })

  it('still creates a mention notification with the mention email when a remote reply to another actor also mentions the recipient', async () => {
    const actor = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
    // Parent post belongs to ACTOR1, not the current actor (ACTOR3).
    const otherActorPost = await createNote(
      database,
      ACTOR1_ID,
      'Post owned by another actor',
      `${ACTOR1_ID}/followers`
    )
    // Remote actor replies to ACTOR1's post but mentions ACTOR3.
    const replyMentionStatus = await createNote(
      database,
      EXTERNAL_ACTOR1,
      `Replying to test1 but pinging ${getActorURL(actor)}`,
      EXTERNAL_ACTOR1_FOLLOWERS,
      otherActorPost.id
    )
    await createMentionTag(
      database,
      replyMentionStatus.id,
      getActorURL(actor),
      actor.username
    )

    await notifyRemoteReplyAndMention({
      database,
      currentActor: actor,
      status: replyMentionStatus
    })

    // ACTOR3 is not the parent author, so the reply branch does not fire and the
    // mention must NOT be suppressed: exactly one mention notification, carrying
    // the mention email template (not the reply one).
    const forStatus = await notificationsForStatus(
      database,
      actor.id,
      replyMentionStatus.id
    )
    expect(forStatus).toHaveLength(1)
    expect(forStatus[0].type).toBe(NotificationType.enum.mention)

    expect(mockSendAlerts).toHaveBeenCalledTimes(1)
    const { events } = mockSendAlerts.mock.calls[0][0]
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: NotificationType.enum.mention,
      emailContent: expect.objectContaining({
        subject: expect.stringContaining('mentions you in')
      })
    })
  })

  it('does not notify for a remote reply to another actor post', async () => {
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

    await notifyRemoteReplyAndMention({
      database,
      currentActor: actor,
      status: replyStatus
    })

    // Not a reply to our post and no mention → no notification.
    expect(
      await notificationsForStatus(database, actor.id, replyStatus.id)
    ).toHaveLength(0)
    expect(mockSendAlerts).not.toHaveBeenCalled()
  })

  describe('notifyRemoteMention', () => {
    it('creates a mention-only notification with email alert and skips duplicate calls', async () => {
      const actor = (await database.getActorFromId({ id: ACTOR2_ID })) as Actor
      // The parent belongs to another actor: a reply to the recipient's own
      // post is covered by the reply notification instead.
      const parentPost = await createNote(
        database,
        ACTOR1_ID,
        'Parent post by actor1',
        `${ACTOR1_ID}/followers`
      )
      const remoteReply = await createNote(
        database,
        EXTERNAL_ACTOR1,
        `Edited reply mentioning ${getActorURL(actor)}`,
        EXTERNAL_ACTOR1_FOLLOWERS,
        parentPost.id
      )

      await notifyRemoteMention({
        database,
        currentActor: actor,
        status: remoteReply
      })
      await notifyRemoteMention({
        database,
        currentActor: actor,
        status: remoteReply
      })

      const forStatus = await notificationsForStatus(
        database,
        actor.id,
        remoteReply.id
      )
      expect(forStatus).toHaveLength(1)
      expect(forStatus[0].type).toBe(NotificationType.enum.mention)
      expect(mockSendAlerts).toHaveBeenCalledTimes(1)
      expect(mockSendAlerts).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: actor.id,
          sourceActorId: EXTERNAL_ACTOR1,
          statusId: remoteReply.id,
          events: [
            expect.objectContaining({
              type: NotificationType.enum.mention,
              emailContent: expect.objectContaining({
                subject: expect.stringContaining('mentions you in')
              })
            })
          ]
        })
      )
    })

    it('does not notify a local actor who cannot read the status', async () => {
      const actorA = (await database.getActorFromId({ id: ACTOR2_ID })) as Actor
      const actorB = (await database.getActorFromId({ id: ACTOR3_ID })) as Actor
      const id = randomBytes(16).toString('hex')
      const directNote = await database.createNote({
        id: `${EXTERNAL_ACTOR1}/statuses/${id}`,
        url: `${EXTERNAL_ACTOR1}/statuses/${id}`,
        actorId: EXTERNAL_ACTOR1,
        to: [actorA.id],
        cc: [],
        text: 'Direct note to actor2'
      })

      // The Update adds a Mention tag for actorB without addressing them.
      await createMentionTag(
        database,
        directNote.id,
        getActorURL(actorB),
        actorB.username
      )
      await notifyRemoteMention({
        database,
        currentActor: actorB,
        status: directNote
      })
      expect(
        await notificationsForStatus(database, actorB.id, directNote.id)
      ).toHaveLength(0)

      // actorA is addressed, so a newly added mention still notifies them.
      await createMentionTag(
        database,
        directNote.id,
        getActorURL(actorA),
        actorA.username
      )
      await notifyRemoteMention({
        database,
        currentActor: actorA,
        status: directNote
      })
      expect(
        await notificationsForStatus(database, actorA.id, directNote.id)
      ).toHaveLength(1)
    })

    it('does not add a mention notification when the recipient authored the parent', async () => {
      const actor = (await database.getActorFromId({ id: ACTOR2_ID })) as Actor
      const parentPost = await createNote(
        database,
        ACTOR2_ID,
        'Parent post by actor2',
        `${ACTOR2_ID}/followers`
      )
      const remoteReply = await createNote(
        database,
        EXTERNAL_ACTOR1,
        'Reply without a mention tag',
        EXTERNAL_ACTOR1_FOLLOWERS,
        parentPost.id
      )

      await notifyRemoteReplyAndMention({
        database,
        currentActor: actor,
        status: remoteReply
      })
      const afterReply = await notificationsForStatus(
        database,
        actor.id,
        remoteReply.id
      )
      expect(afterReply).toHaveLength(1)
      expect(afterReply[0].type).toBe(NotificationType.enum.reply)

      // The Update adds a Mention tag for the parent's author.
      await createMentionTag(
        database,
        remoteReply.id,
        getActorURL(actor),
        actor.username
      )
      await notifyRemoteMention({
        database,
        currentActor: actor,
        status: remoteReply
      })

      const afterMention = await notificationsForStatus(
        database,
        actor.id,
        remoteReply.id
      )
      expect(afterMention).toHaveLength(1)
      expect(afterMention[0].type).toBe(NotificationType.enum.reply)
    })
  })

  describe('hasMentionNotification', () => {
    it('reports a mention notification for the status, filtered or not', async () => {
      const actor = (await database.getActorFromId({ id: ACTOR2_ID })) as Actor
      const status = await createNote(
        database,
        EXTERNAL_ACTOR1,
        'Hello',
        EXTERNAL_ACTOR1_FOLLOWERS
      )

      expect(
        await hasMentionNotification({
          database,
          actorId: actor.id,
          statusId: status.id
        })
      ).toBe(false)

      await database.createNotification({
        actorId: actor.id,
        type: NotificationType.enum.mention,
        sourceActorId: EXTERNAL_ACTOR1,
        statusId: status.id,
        groupKey: `mention:${status.id}`,
        filtered: true
      })

      expect(
        await hasMentionNotification({
          database,
          actorId: actor.id,
          statusId: status.id
        })
      ).toBe(true)
    })
  })
})

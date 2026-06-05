import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Verifies the conversation-mute suppression branch of the single
// notification-creation seam: a recipient who muted a thread receives no
// notifications for statuses in that thread.
describe('createNotificationWithPolicy conversation-mute suppression', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('drops a notification for a status whose conversation the recipient muted', async () => {
    const statusId = `${ACTOR2_ID}/statuses/mute-suppression-target`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'A status in a muted conversation',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    // ACTOR1 mutes the conversation (root == the status itself here).
    await database.createStatusMute({ actorId: ACTOR1_ID, statusId })

    const notification = await createNotificationWithPolicy(database, {
      actorId: ACTOR1_ID,
      type: 'favourite',
      sourceActorId: ACTOR2_ID,
      statusId
    })

    expect(notification).toBeNull()
    const stored = await database.getNotifications({
      actorId: ACTOR1_ID,
      limit: 20
    })
    expect(stored.some((item) => item.statusId === statusId)).toBe(false)
  })

  it('drops a notification for a reply in a muted thread (root resolution)', async () => {
    const rootId = `${ACTOR2_ID}/statuses/mute-suppression-root`
    const replyId = `${ACTOR2_ID}/statuses/mute-suppression-reply`
    await database.createNote({
      id: rootId,
      url: rootId,
      actorId: ACTOR2_ID,
      text: 'Root of a muted thread',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createNote({
      id: replyId,
      url: replyId,
      actorId: ACTOR2_ID,
      text: 'A reply inside the muted thread',
      reply: rootId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createStatusMute({ actorId: ACTOR1_ID, statusId: rootId })

    const notification = await createNotificationWithPolicy(database, {
      actorId: ACTOR1_ID,
      type: 'mention',
      sourceActorId: ACTOR2_ID,
      statusId: replyId
    })

    expect(notification).toBeNull()
  })

  it('persists a notification for a status in a non-muted conversation', async () => {
    const statusId = `${ACTOR2_ID}/statuses/mute-suppression-control`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'A status in a non-muted conversation',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const notification = await createNotificationWithPolicy(database, {
      actorId: ACTOR1_ID,
      type: 'favourite',
      sourceActorId: ACTOR2_ID,
      statusId
    })

    expect(notification).not.toBeNull()
  })

  it('never suppresses an account-level notification with no statusId (e.g. follow)', async () => {
    const notification = await createNotificationWithPolicy(database, {
      actorId: ACTOR1_ID,
      type: 'follow',
      sourceActorId: ACTOR2_ID
    })

    expect(notification).not.toBeNull()
  })
})

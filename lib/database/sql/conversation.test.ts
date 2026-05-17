import { randomBytes } from 'crypto'

import {
  TestDatabaseTable,
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { DirectConversation } from '@/lib/types/database/operations'
import { StatusNote } from '@/lib/types/domain/status'

const createDirectStatus = async ({
  database,
  actorId,
  recipientActorIds,
  text,
  reply,
  createdAt
}: {
  database: Database
  actorId: string
  recipientActorIds: string[]
  text: string
  reply?: string
  createdAt?: number
}): Promise<StatusNote> => {
  const id = `${actorId}/statuses/${randomBytes(8).toString('hex')}`
  const status = await database.createNote({
    id,
    url: id,
    actorId,
    text,
    to: recipientActorIds,
    cc: [],
    reply,
    createdAt
  })
  await database.syncDirectConversationForStatus({ status })
  return status as StatusNote
}

describe('ConversationDatabase', () => {
  const table: TestDatabaseTable = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
    await Promise.all(table.map((item) => seedDatabase(item[1])))
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    test('syncs direct statuses into local actor conversation memberships', async () => {
      const status = await createDirectStatus({
        database,
        actorId: ACTOR1_ID,
        recipientActorIds: [ACTOR2_ID],
        text: 'private hello'
      })

      const actor1Conversations = await database.getDirectConversations({
        actorId: ACTOR1_ID
      })
      const actor2Conversations = await database.getDirectConversations({
        actorId: ACTOR2_ID
      })

      expect(actor1Conversations).toHaveLength(1)
      expect(actor2Conversations).toHaveLength(1)
      expect(actor1Conversations[0].id).not.toEqual(actor2Conversations[0].id)
      expect(actor1Conversations[0].conversationId).toEqual(
        actor2Conversations[0].conversationId
      )
      expect(actor1Conversations[0].lastStatusId).toEqual(status.id)
      expect(actor2Conversations[0].lastStatusId).toEqual(status.id)
      expect(actor1Conversations[0].unread).toBe(false)
      expect(actor2Conversations[0].unread).toBe(true)
      expect(actor1Conversations[0].participantActorIds.sort()).toEqual([
        ACTOR1_ID,
        ACTOR2_ID
      ])
    })

    test('keeps replies in the same direct conversation and updates unread state', async () => {
      const root = await createDirectStatus({
        database,
        actorId: ACTOR1_ID,
        recipientActorIds: [ACTOR2_ID, ACTOR3_ID],
        text: 'group root',
        createdAt: 1000
      })
      const reply = await createDirectStatus({
        database,
        actorId: ACTOR2_ID,
        recipientActorIds: [ACTOR1_ID, ACTOR3_ID],
        text: 'group reply',
        reply: root.id,
        createdAt: 2000
      })

      const actor1Conversation = (
        await database.getDirectConversations({ actorId: ACTOR1_ID })
      ).find(
        (conversation: DirectConversation) =>
          conversation.lastStatusId === reply.id
      )
      const actor2Conversation = (
        await database.getDirectConversations({ actorId: ACTOR2_ID })
      ).find(
        (conversation: DirectConversation) =>
          conversation.lastStatusId === reply.id
      )
      const actor3Conversation = (
        await database.getDirectConversations({ actorId: ACTOR3_ID })
      ).find(
        (conversation: DirectConversation) =>
          conversation.lastStatusId === reply.id
      )

      expect(actor1Conversation).toBeDefined()
      expect(actor2Conversation).toBeDefined()
      expect(actor3Conversation).toBeDefined()
      expect(actor1Conversation.conversationId).toEqual(
        actor2Conversation.conversationId
      )
      expect(actor2Conversation.conversationId).toEqual(
        actor3Conversation.conversationId
      )
      expect(actor1Conversation.unread).toBe(true)
      expect(actor2Conversation.unread).toBe(false)
      expect(actor3Conversation.unread).toBe(true)
      expect(actor3Conversation.participantActorIds.sort()).toEqual([
        ACTOR1_ID,
        ACTOR2_ID,
        ACTOR3_ID
      ])
    })

    test('marks conversations read, hides them, and unhides on newer direct replies', async () => {
      const root = await createDirectStatus({
        database,
        actorId: EXTERNAL_ACTOR1,
        recipientActorIds: [ACTOR1_ID],
        text: 'external direct root',
        createdAt: 3000
      })
      const conversation = (
        await database.getDirectConversations({
          actorId: ACTOR1_ID
        })
      ).find((item: DirectConversation) => item.lastStatusId === root.id)
      expect(conversation).toBeDefined()
      if (!conversation) fail('Conversation must be defined')

      const readConversation = await database.markDirectConversationRead({
        actorId: ACTOR1_ID,
        conversationId: conversation.id
      })
      expect(readConversation.unread).toBe(false)
      expect(readConversation.readAt).not.toBeNull()

      await database.hideDirectConversation({
        actorId: ACTOR1_ID,
        conversationId: conversation.id
      })
      await expect(
        database.getDirectConversation({
          actorId: ACTOR1_ID,
          conversationId: conversation.id
        })
      ).resolves.toBeNull()

      const reply = await createDirectStatus({
        database,
        actorId: EXTERNAL_ACTOR1,
        recipientActorIds: [ACTOR1_ID],
        text: 'external direct reply',
        reply: root.id,
        createdAt: 4000
      })
      const visibleConversation = (
        await database.getDirectConversations({
          actorId: ACTOR1_ID
        })
      ).find((item: DirectConversation) => item.lastStatusId === reply.id)
      expect(visibleConversation).toBeDefined()
      if (!visibleConversation) fail('Visible conversation must be defined')

      expect(visibleConversation.id).toEqual(conversation.id)
      expect(visibleConversation.lastStatusId).toEqual(reply.id)
      expect(visibleConversation.unread).toBe(true)
      expect(visibleConversation.hiddenAt).toBeNull()
    })
  })
})

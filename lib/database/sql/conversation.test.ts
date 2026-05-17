import { createHash, randomBytes } from 'crypto'
import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { DirectConversationSQLDatabaseMixin } from '@/lib/database/sql/conversation'
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
import {
  DirectConversation,
  StatusDatabase
} from '@/lib/types/database/operations'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'

const createMemoryKnex = () =>
  knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })

const createDirectConversationTables = async (database: Knex) => {
  await database.schema.createTable('actors', (table) => {
    table.string('id').primary()
    table.text('privateKey')
  })
  await database.schema.createTable('direct_conversations', (table) => {
    table.string('id').primary()
    table.string('rootStatusId').notNullable()
    table.timestamp('createdAt', { useTz: true })
    table.timestamp('updatedAt', { useTz: true })
  })
  await database.schema.createTable(
    'direct_conversation_participants',
    (table) => {
      table.string('id').primary()
      table.string('conversationId').notNullable()
      table.string('actorId').notNullable()
      table.timestamp('createdAt', { useTz: true })
      table.timestamp('updatedAt', { useTz: true })
      table.unique(['conversationId', 'actorId'])
    }
  )
  await database.schema.createTable('direct_conversation_statuses', (table) => {
    table.string('conversationId').notNullable()
    table.string('statusId').notNullable()
    table.timestamp('createdAt', { useTz: true }).notNullable()
    table.timestamp('updatedAt', { useTz: true })
    table.primary(['conversationId', 'statusId'])
  })
  await database.schema.createTable(
    'direct_conversation_memberships',
    (table) => {
      table.bigIncrements('id').primary()
      table.string('actorId').notNullable()
      table.string('conversationId').notNullable()
      table.string('lastStatusId').notNullable()
      table.timestamp('lastStatusCreatedAt', { useTz: true }).notNullable()
      table.boolean('unread').notNullable().defaultTo(false)
      table.timestamp('readAt', { useTz: true }).nullable()
      table.timestamp('hiddenAt', { useTz: true }).nullable()
      table.timestamp('createdAt', { useTz: true })
      table.timestamp('updatedAt', { useTz: true })
      table.unique(['actorId', 'conversationId'])
    }
  )
}

const statusForId = (id: string): Status =>
  ({
    id,
    url: id,
    actorId: ACTOR1_ID,
    actor: null,
    type: StatusType.enum.Note,
    text: id,
    summary: '',
    reply: '',
    to: [ACTOR2_ID],
    cc: [],
    createdAt: 1000,
    updatedAt: 1000,
    attachments: [],
    mentions: [],
    likesCount: 0,
    repliesCount: 0,
    reblogsCount: 0,
    liked: false,
    bookmarked: false
  }) as Status

const conversationIdForRoot = (rootStatusId: string) =>
  createHash('sha256').update(rootStatusId).digest('hex')

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

    test('filters narrowed direct replies out of status lists for removed participants', async () => {
      const root = await createDirectStatus({
        database,
        actorId: ACTOR1_ID,
        recipientActorIds: [ACTOR2_ID, ACTOR3_ID],
        text: 'visible to the group',
        createdAt: 5000
      })
      const reply = await createDirectStatus({
        database,
        actorId: ACTOR2_ID,
        recipientActorIds: [ACTOR1_ID],
        text: 'visible to actor1 only',
        reply: root.id,
        createdAt: 6000
      })
      const actor3Conversation = (
        await database.getDirectConversations({ actorId: ACTOR3_ID })
      ).find(
        (conversation: DirectConversation) =>
          conversation.rootStatusId === root.id
      )

      expect(actor3Conversation).toBeDefined()
      if (!actor3Conversation) fail('Actor3 conversation must be defined')

      const statuses = await database.getDirectConversationStatuses({
        actorId: ACTOR3_ID,
        conversationId: actor3Conversation.id
      })

      expect(statuses.map((status) => status.id)).toContain(root.id)
      expect(statuses.map((status) => status.id)).not.toContain(reply.id)
    })
  })

  describe('sqlite implementation details', () => {
    let knexDatabase: Knex
    let database: Database

    beforeEach(async () => {
      knexDatabase = createMemoryKnex()
      database = getSQLDatabase(knexDatabase)
      await database.migrate()
      await seedDatabase(database)
    })

    afterEach(async () => {
      await database.destroy()
    })

    test('falls back to the latest hydratable conversation status when membership last status is stale', async () => {
      const root = await createDirectStatus({
        database,
        actorId: ACTOR2_ID,
        recipientActorIds: [ACTOR1_ID],
        text: 'fallback root',
        createdAt: 7000
      })
      const reply = await createDirectStatus({
        database,
        actorId: ACTOR1_ID,
        recipientActorIds: [ACTOR2_ID],
        text: 'fallback reply',
        reply: root.id,
        createdAt: 8000
      })
      const [membership] = await knexDatabase('direct_conversation_memberships')
        .where({
          actorId: ACTOR1_ID,
          lastStatusId: reply.id
        })
        .select<{ id: string | number; conversationId: string }[]>()

      await knexDatabase('direct_conversation_memberships')
        .where('id', membership.id)
        .update({
          lastStatusId: `${reply.id}/missing`,
          lastStatusCreatedAt: new Date(9000),
          unread: true,
          readAt: new Date(9000)
        })

      const conversations = await database.getDirectConversations({
        actorId: ACTOR1_ID
      })
      const conversation = conversations.find(
        (item) => item.conversationId === membership.conversationId
      )
      const updatedMembership = await knexDatabase(
        'direct_conversation_memberships'
      )
        .where('id', membership.id)
        .first<{
          lastStatusId: string
          unread: boolean | number
          readAt: Date
        }>()

      expect(conversation?.lastStatusId).toEqual(reply.id)
      expect(conversation?.lastStatus.id).toEqual(reply.id)
      expect(conversation?.unread).toBe(false)
      expect(conversation?.readAt).toEqual(9000)
      expect(updatedMembership?.lastStatusId).toEqual(reply.id)
      expect(Boolean(updatedMembership?.unread)).toBe(false)
      expect(new Date(updatedMembership?.readAt ?? 0).getTime()).toEqual(9000)
    })

    test('returns empty results for malformed membership cursors', async () => {
      await expect(
        database.getDirectConversations({
          actorId: ACTOR1_ID,
          maxId: 'not-a-bigint'
        })
      ).resolves.toEqual([])
      await expect(
        database.getDirectConversation({
          actorId: ACTOR1_ID,
          conversationId: 'not-a-bigint'
        })
      ).resolves.toBeNull()
      await expect(
        database.getDirectConversationStatuses({
          actorId: ACTOR1_ID,
          conversationId: 'not-a-bigint'
        })
      ).resolves.toEqual([])
    })
  })

  describe('direct conversation mixin', () => {
    let knexDatabase: Knex

    beforeEach(async () => {
      knexDatabase = createMemoryKnex()
      await createDirectConversationTables(knexDatabase)
    })

    afterEach(async () => {
      await knexDatabase.destroy()
    })

    test('preserves database row order when status hydration returns unordered results', async () => {
      const statusDatabase = {
        getStatusesByIds: jest.fn(async ({ statusIds }) =>
          statusIds.map(statusForId).reverse()
        )
      } as unknown as StatusDatabase
      const database = DirectConversationSQLDatabaseMixin(
        knexDatabase,
        statusDatabase
      )
      const now = new Date()

      await knexDatabase('direct_conversations').insert({
        id: 'conversation-ordered',
        rootStatusId: 'status-1',
        createdAt: now,
        updatedAt: now
      })
      await knexDatabase('direct_conversation_participants').insert({
        id: 'participant-1',
        conversationId: 'conversation-ordered',
        actorId: ACTOR1_ID,
        createdAt: now,
        updatedAt: now
      })
      await knexDatabase('direct_conversation_memberships').insert({
        actorId: ACTOR1_ID,
        conversationId: 'conversation-ordered',
        lastStatusId: 'status-3',
        lastStatusCreatedAt: new Date(3000),
        unread: false,
        readAt: null,
        hiddenAt: null,
        createdAt: now,
        updatedAt: now
      })
      await knexDatabase('direct_conversation_statuses').insert([
        {
          conversationId: 'conversation-ordered',
          statusId: 'status-1',
          createdAt: new Date(1000),
          updatedAt: now
        },
        {
          conversationId: 'conversation-ordered',
          statusId: 'status-2',
          createdAt: new Date(2000),
          updatedAt: now
        },
        {
          conversationId: 'conversation-ordered',
          statusId: 'status-3',
          createdAt: new Date(3000),
          updatedAt: now
        }
      ])

      const statuses = await database.getDirectConversationStatuses({
        actorId: ACTOR1_ID,
        conversationId: '1'
      })

      expect(statuses.map((status) => status.id)).toEqual([
        'status-3',
        'status-2',
        'status-1'
      ])
    })

    test('scans past invisible statuses to fill direct conversation status pages', async () => {
      const statusDatabase = {
        getStatusesByIds: jest.fn(async ({ statusIds }) =>
          statusIds
            .filter(
              (statusId: string) => !['status-4', 'status-2'].includes(statusId)
            )
            .map(statusForId)
        )
      } as unknown as StatusDatabase
      const database = DirectConversationSQLDatabaseMixin(
        knexDatabase,
        statusDatabase
      )
      const now = new Date()

      await knexDatabase('direct_conversations').insert({
        id: 'conversation-with-invisible-statuses',
        rootStatusId: 'status-1',
        createdAt: now,
        updatedAt: now
      })
      await knexDatabase('direct_conversation_participants').insert({
        id: 'participant-1',
        conversationId: 'conversation-with-invisible-statuses',
        actorId: ACTOR1_ID,
        createdAt: now,
        updatedAt: now
      })
      await knexDatabase('direct_conversation_memberships').insert({
        actorId: ACTOR1_ID,
        conversationId: 'conversation-with-invisible-statuses',
        lastStatusId: 'status-5',
        lastStatusCreatedAt: new Date(5000),
        unread: false,
        readAt: null,
        hiddenAt: null,
        createdAt: now,
        updatedAt: now
      })
      await knexDatabase('direct_conversation_statuses').insert([
        {
          conversationId: 'conversation-with-invisible-statuses',
          statusId: 'status-1',
          createdAt: new Date(1000),
          updatedAt: now
        },
        {
          conversationId: 'conversation-with-invisible-statuses',
          statusId: 'status-2',
          createdAt: new Date(2000),
          updatedAt: now
        },
        {
          conversationId: 'conversation-with-invisible-statuses',
          statusId: 'status-3',
          createdAt: new Date(3000),
          updatedAt: now
        },
        {
          conversationId: 'conversation-with-invisible-statuses',
          statusId: 'status-4',
          createdAt: new Date(4000),
          updatedAt: now
        },
        {
          conversationId: 'conversation-with-invisible-statuses',
          statusId: 'status-5',
          createdAt: new Date(5000),
          updatedAt: now
        }
      ])

      const firstPage = await database.getDirectConversationStatuses({
        actorId: ACTOR1_ID,
        conversationId: '1',
        limit: 2
      })
      const secondPage = await database.getDirectConversationStatuses({
        actorId: ACTOR1_ID,
        conversationId: '1',
        maxStatusId: 'status-3',
        limit: 2
      })

      expect(firstPage.map((status) => status.id)).toEqual([
        'status-5',
        'status-3'
      ])
      expect(secondPage.map((status) => status.id)).toEqual(['status-1'])
    })

    test('resolves reply roots from synced direct conversation rows before hydrating parents', async () => {
      const getStatus = jest.fn()
      const statusDatabase = {
        getStatus,
        getStatusesByIds: jest.fn(async ({ statusIds }) =>
          statusIds.map(statusForId)
        )
      } as unknown as StatusDatabase
      const database = DirectConversationSQLDatabaseMixin(
        knexDatabase,
        statusDatabase
      )
      const now = new Date()
      const conversationId = conversationIdForRoot('root-status')

      await knexDatabase('actors').insert([
        { id: ACTOR1_ID, privateKey: 'private-key-1' },
        { id: ACTOR2_ID, privateKey: 'private-key-2' }
      ])
      await knexDatabase('direct_conversations').insert({
        id: conversationId,
        rootStatusId: 'root-status',
        createdAt: now,
        updatedAt: now
      })
      await knexDatabase('direct_conversation_statuses').insert({
        conversationId,
        statusId: 'parent-status',
        createdAt: new Date(1000),
        updatedAt: now
      })

      await database.syncDirectConversationForStatus({
        status: {
          ...statusForId('reply-status'),
          actorId: ACTOR1_ID,
          reply: 'parent-status',
          to: [ACTOR2_ID],
          cc: [],
          createdAt: 2000
        } as StatusNote
      })

      const syncedReply = await knexDatabase('direct_conversation_statuses')
        .where('statusId', 'reply-status')
        .first<{ conversationId: string }>()

      expect(getStatus).not.toHaveBeenCalled()
      expect(syncedReply?.conversationId).toEqual(conversationId)
    })
  })
})

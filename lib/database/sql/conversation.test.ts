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

    test('includes recipientless direct replies to local non-direct statuses', async () => {
      const parent = await database.createNote({
        id: `${ACTOR1_ID}/statuses/public-parent-for-direct-reply-id`,
        url: `${ACTOR1_ID}/statuses/public-parent-for-direct-reply-url`,
        actorId: ACTOR1_ID,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${ACTOR1_ID}/followers`],
        text: 'public parent',
        createdAt: 6500
      })
      const directReply = await database.createNote({
        id: `${EXTERNAL_ACTOR1}/statuses/recipientless-direct-reply`,
        url: `${EXTERNAL_ACTOR1}/statuses/recipientless-direct-reply`,
        actorId: EXTERNAL_ACTOR1,
        to: [],
        cc: [],
        text: 'recipientless direct reply',
        reply: parent.url,
        createdAt: 6600
      })

      await database.syncDirectConversationForStatus({ status: directReply })

      const conversation = (
        await database.getDirectConversations({ actorId: ACTOR1_ID })
      ).find((item: DirectConversation) => item.lastStatusId === directReply.id)

      expect(conversation).toBeDefined()
      if (!conversation) fail('Conversation must be defined')
      expect(conversation.participantActorIds.sort()).toEqual(
        [ACTOR1_ID, EXTERNAL_ACTOR1].sort()
      )

      const statuses = await database.getDirectConversationStatuses({
        actorId: ACTOR1_ID,
        conversationId: conversation.id
      })

      expect(statuses.map((status) => status.id)).toContain(directReply.id)
    })

    test('does not create direct conversations for recipientless replies to remote non-direct statuses', async () => {
      const suffix = randomBytes(8).toString('hex')
      const parent = await database.createNote({
        id: `${EXTERNAL_ACTOR1}/statuses/remote-public-parent-${suffix}`,
        url: `${EXTERNAL_ACTOR1}/statuses/remote-public-parent-${suffix}`,
        actorId: EXTERNAL_ACTOR1,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${EXTERNAL_ACTOR1}/followers`],
        text: 'remote public parent',
        createdAt: 6650
      })
      const recipientlessReply = await database.createNote({
        id: `${ACTOR1_ID}/statuses/recipientless-remote-parent-reply-${suffix}`,
        url: `${ACTOR1_ID}/statuses/recipientless-remote-parent-reply-${suffix}`,
        actorId: ACTOR1_ID,
        to: [],
        cc: [],
        text: 'recipientless reply to remote public parent',
        reply: parent.id,
        createdAt: 6660
      })

      await database.syncDirectConversationForStatus({
        status: recipientlessReply
      })

      const actor1Conversation = (
        await database.getDirectConversations({ actorId: ACTOR1_ID })
      ).find(
        (item: DirectConversation) =>
          item.lastStatusId === recipientlessReply.id
      )

      expect(actor1Conversation).toBeUndefined()
    })

    test('inherits parent conversation participants for recipientless direct replies', async () => {
      const root = await createDirectStatus({
        database,
        actorId: ACTOR2_ID,
        recipientActorIds: [ACTOR1_ID, ACTOR3_ID],
        text: 'group root for recipientless reply',
        createdAt: 6700
      })
      const recipientlessReply = await database.createNote({
        id: `${ACTOR1_ID}/statuses/recipientless-group-reply`,
        url: `${ACTOR1_ID}/statuses/recipientless-group-reply`,
        actorId: ACTOR1_ID,
        to: [],
        cc: [],
        text: 'recipientless group reply',
        reply: root.url,
        createdAt: 6800
      })

      await database.syncDirectConversationForStatus({
        status: recipientlessReply
      })

      const actor3Conversation = (
        await database.getDirectConversations({ actorId: ACTOR3_ID })
      ).find(
        (item: DirectConversation) =>
          item.lastStatusId === recipientlessReply.id
      )

      expect(actor3Conversation).toBeDefined()
      if (!actor3Conversation) fail('Actor3 conversation must be defined')
      expect(actor3Conversation.rootStatusId).toEqual(root.id)
      expect(actor3Conversation.participantActorIds.sort()).toEqual(
        [ACTOR1_ID, ACTOR2_ID, ACTOR3_ID].sort()
      )
      expect(actor3Conversation.unread).toBe(true)

      const statuses = await database.getDirectConversationStatuses({
        actorId: ACTOR3_ID,
        conversationId: actor3Conversation.id
      })
      expect(statuses.map((status) => status.id)).toContain(
        recipientlessReply.id
      )
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
      const persistedMembership = await knexDatabase(
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
      expect(persistedMembership?.lastStatusId).toEqual(`${reply.id}/missing`)
      expect(Boolean(persistedMembership?.unread)).toBe(true)
      expect(new Date(persistedMembership?.readAt ?? 0).getTime()).toEqual(9000)
    })

    test('keeps conversation rows when local participants are excluded from memberships', async () => {
      const suffix = randomBytes(8).toString('hex')
      const status = await database.createNote({
        id: `${ACTOR1_ID}/statuses/excluded-local-direct-${suffix}`,
        url: `${ACTOR1_ID}/statuses/excluded-local-direct-${suffix}`,
        actorId: ACTOR1_ID,
        to: [EXTERNAL_ACTOR1],
        cc: [],
        text: 'local to remote direct with excluded local membership',
        createdAt: 8500
      })

      await database.syncDirectConversationForStatus({
        status,
        excludedLocalActorIds: [ACTOR1_ID]
      })

      const conversationStatus = await knexDatabase(
        'direct_conversation_statuses'
      )
        .where({ statusId: status.id })
        .first<{ conversationId: string }>()
      expect(conversationStatus).toBeDefined()
      if (!conversationStatus) fail('Conversation status must be defined')

      const participantRows = await knexDatabase(
        'direct_conversation_participants'
      )
        .where({ conversationId: conversationStatus.conversationId })
        .select<{ actorId: string }[]>('actorId')
      const membershipRows = await knexDatabase(
        'direct_conversation_memberships'
      ).where({ conversationId: conversationStatus.conversationId })

      expect(participantRows.map((row) => row.actorId).sort()).toEqual(
        [ACTOR1_ID, EXTERNAL_ACTOR1].sort()
      )
      expect(membershipRows).toEqual([])
    })

    test('bounds fallback status hydration when membership last status is stale', async () => {
      const getStatusesByIds = jest.fn(async ({ statusIds }) =>
        statusIds
          .filter((statusId: string) => statusId === 'status-60')
          .map(statusForId)
      )
      const database = DirectConversationSQLDatabaseMixin(knexDatabase, {
        getStatusesByIds
      } as unknown as StatusDatabase)
      const now = new Date()
      const conversationId = 'conversation-with-long-stale-tail'

      await knexDatabase('direct_conversations').insert({
        id: conversationId,
        rootStatusId: 'status-1',
        createdAt: now,
        updatedAt: now
      })
      await knexDatabase('direct_conversation_participants').insert({
        id: 'participant-long-stale-tail',
        conversationId,
        actorId: ACTOR1_ID,
        createdAt: now,
        updatedAt: now
      })
      await knexDatabase('direct_conversation_memberships').insert({
        actorId: ACTOR1_ID,
        conversationId,
        lastStatusId: 'missing-last-status',
        lastStatusCreatedAt: new Date(121_000),
        unread: true,
        readAt: null,
        hiddenAt: null,
        createdAt: now,
        updatedAt: now
      })
      await knexDatabase('direct_conversation_statuses').insert(
        Array.from({ length: 120 }, (_, index) => {
          const statusNumber = index + 1
          return {
            conversationId,
            statusId: `status-${statusNumber}`,
            createdAt: new Date(statusNumber * 1000),
            updatedAt: now
          }
        })
      )

      const conversations = await database.getDirectConversations({
        actorId: ACTOR1_ID
      })
      const fallbackCalls = getStatusesByIds.mock.calls
        .slice(1)
        .map(([params]) => params.statusIds as string[])

      expect(
        conversations.map((conversation) => conversation.lastStatusId)
      ).toEqual(['status-60'])
      expect(fallbackCalls).toHaveLength(2)
      expect(fallbackCalls.every((statusIds) => statusIds.length <= 50)).toBe(
        true
      )
      expect(fallbackCalls[0][0]).toEqual('status-120')
      expect(fallbackCalls[1]).toContain('status-60')
    })

    test('hydrates stale fallbacks for multiple conversations in shared batches', async () => {
      const getStatusesByIds = jest.fn(async ({ statusIds }) =>
        statusIds
          .filter((statusId: string) =>
            ['conversation-a-status-2', 'conversation-b-status-3'].includes(
              statusId
            )
          )
          .map(statusForId)
      )
      const database = DirectConversationSQLDatabaseMixin(knexDatabase, {
        getStatusesByIds
      } as unknown as StatusDatabase)
      const now = new Date()
      const staleConversations = [
        {
          conversationId: 'conversation-a',
          missingStatusId: 'conversation-a-missing-status',
          fallbackStatusIds: [
            'conversation-a-status-1',
            'conversation-a-status-2'
          ]
        },
        {
          conversationId: 'conversation-b',
          missingStatusId: 'conversation-b-missing-status',
          fallbackStatusIds: [
            'conversation-b-status-1',
            'conversation-b-status-2',
            'conversation-b-status-3'
          ]
        }
      ]

      await knexDatabase('direct_conversations').insert(
        staleConversations.map((conversation) => ({
          id: conversation.conversationId,
          rootStatusId: conversation.fallbackStatusIds[0],
          createdAt: now,
          updatedAt: now
        }))
      )
      await knexDatabase('direct_conversation_participants').insert(
        staleConversations.map((conversation) => ({
          id: `participant-${conversation.conversationId}`,
          conversationId: conversation.conversationId,
          actorId: ACTOR1_ID,
          createdAt: now,
          updatedAt: now
        }))
      )
      await knexDatabase('direct_conversation_memberships').insert(
        staleConversations.map((conversation, index) => ({
          actorId: ACTOR1_ID,
          conversationId: conversation.conversationId,
          lastStatusId: conversation.missingStatusId,
          lastStatusCreatedAt: new Date(10_000 - index * 1000),
          unread: true,
          readAt: null,
          hiddenAt: null,
          createdAt: now,
          updatedAt: now
        }))
      )
      await knexDatabase('direct_conversation_statuses').insert(
        staleConversations.flatMap((conversation) =>
          conversation.fallbackStatusIds.map((statusId, index) => ({
            conversationId: conversation.conversationId,
            statusId,
            createdAt: new Date((index + 1) * 1000),
            updatedAt: now
          }))
        )
      )

      const fallbackStatusRowQueries: string[] = []
      const queryListener = ({ sql }: { sql: string }) => {
        const normalizedSql = sql.toLowerCase()
        if (
          normalizedSql.startsWith('select') &&
          normalizedSql.includes('direct_conversation_statuses')
        ) {
          fallbackStatusRowQueries.push(sql)
        }
      }
      const conversations = await (async () => {
        knexDatabase.on('query', queryListener)
        try {
          return await database.getDirectConversations({
            actorId: ACTOR1_ID,
            limit: 2
          })
        } finally {
          knexDatabase.off('query', queryListener)
        }
      })()
      const fallbackCalls = getStatusesByIds.mock.calls
        .slice(1)
        .map(([params]) => params.statusIds as string[])

      expect(
        conversations.map((conversation) => conversation.lastStatusId).sort()
      ).toEqual(['conversation-a-status-2', 'conversation-b-status-3'])
      expect(fallbackStatusRowQueries).toHaveLength(1)
      expect(fallbackCalls).toHaveLength(1)
      expect(fallbackCalls[0]).toEqual(
        expect.arrayContaining([
          'conversation-a-status-2',
          'conversation-b-status-3'
        ])
      )
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

    test('returns empty results for non-positive or out-of-range membership ids before querying bigint columns', async () => {
      for (const membershipId of ['0', '0000', '9223372036854775808']) {
        await expect(
          database.getDirectConversations({
            actorId: ACTOR1_ID,
            maxId: membershipId
          })
        ).resolves.toEqual([])
        await expect(
          database.getDirectConversations({
            actorId: ACTOR1_ID,
            minId: membershipId
          })
        ).resolves.toEqual([])
        await expect(
          database.getDirectConversation({
            actorId: ACTOR1_ID,
            conversationId: membershipId
          })
        ).resolves.toBeNull()
        await expect(
          database.getDirectConversationStatuses({
            actorId: ACTOR1_ID,
            conversationId: membershipId
          })
        ).resolves.toEqual([])
      }
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

    test('orders conversation pages by hydratable last status instead of stale membership timestamps', async () => {
      const statusDatabase = {
        getStatusesByIds: jest.fn(async ({ statusIds }) =>
          statusIds
            .filter((statusId: string) => statusId !== 'stale-missing-status')
            .map(statusForId)
        )
      } as unknown as StatusDatabase
      const database = DirectConversationSQLDatabaseMixin(
        knexDatabase,
        statusDatabase
      )
      const now = new Date()

      await knexDatabase('direct_conversations').insert([
        {
          id: 'conversation-stale',
          rootStatusId: 'stale-fallback-status',
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'conversation-fresh',
          rootStatusId: 'fresh-status',
          createdAt: now,
          updatedAt: now
        }
      ])
      await knexDatabase('direct_conversation_participants').insert([
        {
          id: 'participant-stale',
          conversationId: 'conversation-stale',
          actorId: ACTOR1_ID,
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'participant-fresh',
          conversationId: 'conversation-fresh',
          actorId: ACTOR1_ID,
          createdAt: now,
          updatedAt: now
        }
      ])
      await knexDatabase('direct_conversation_memberships').insert([
        {
          actorId: ACTOR1_ID,
          conversationId: 'conversation-stale',
          lastStatusId: 'stale-missing-status',
          lastStatusCreatedAt: new Date(9000),
          unread: true,
          readAt: null,
          hiddenAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          actorId: ACTOR1_ID,
          conversationId: 'conversation-fresh',
          lastStatusId: 'fresh-status',
          lastStatusCreatedAt: new Date(8000),
          unread: false,
          readAt: null,
          hiddenAt: null,
          createdAt: now,
          updatedAt: now
        }
      ])
      await knexDatabase('direct_conversation_statuses').insert([
        {
          conversationId: 'conversation-stale',
          statusId: 'stale-fallback-status',
          createdAt: new Date(1000),
          updatedAt: now
        },
        {
          conversationId: 'conversation-fresh',
          statusId: 'fresh-status',
          createdAt: new Date(8000),
          updatedAt: now
        }
      ])

      const firstPage = await database.getDirectConversations({
        actorId: ACTOR1_ID,
        limit: 1
      })
      const secondPage = await database.getDirectConversations({
        actorId: ACTOR1_ID,
        maxId: firstPage[0].id,
        limit: 1
      })

      expect(
        firstPage.map((conversation) => conversation.lastStatusId)
      ).toEqual(['fresh-status'])
      expect(
        secondPage.map((conversation) => conversation.lastStatusId)
      ).toEqual(['stale-fallback-status'])
    })

    test('continues scanning from the stored boundary when hydration rewrites a stale boundary row', async () => {
      const statusDatabase = {
        getStatusesByIds: jest.fn(async ({ statusIds }) =>
          statusIds
            .filter(
              (statusId: string) =>
                !['missing-status', 'stale-missing-status'].includes(statusId)
            )
            .map(statusForId)
        )
      } as unknown as StatusDatabase
      const database = DirectConversationSQLDatabaseMixin(
        knexDatabase,
        statusDatabase
      )
      const now = new Date()
      const visibleConversations = Array.from({ length: 18 }, (_, index) => ({
        conversationId: `conversation-visible-${index}`,
        statusId: `visible-status-${index}`,
        createdAt: new Date(10_000 - index * 100)
      }))
      const memberships = [
        ...visibleConversations,
        {
          conversationId: 'conversation-missing',
          statusId: 'missing-status',
          createdAt: new Date(8200)
        },
        {
          conversationId: 'conversation-stale-boundary',
          statusId: 'stale-missing-status',
          createdAt: new Date(8100)
        },
        {
          conversationId: 'conversation-after-boundary',
          statusId: 'after-boundary-status',
          createdAt: new Date(8000)
        }
      ]

      await knexDatabase('direct_conversations').insert(
        memberships.map((membership) => ({
          id: membership.conversationId,
          rootStatusId: membership.statusId,
          createdAt: now,
          updatedAt: now
        }))
      )
      await knexDatabase('direct_conversation_participants').insert(
        memberships.map((membership) => ({
          id: `participant-${membership.conversationId}`,
          conversationId: membership.conversationId,
          actorId: ACTOR1_ID,
          createdAt: now,
          updatedAt: now
        }))
      )
      await knexDatabase('direct_conversation_memberships').insert(
        memberships.map((membership) => ({
          actorId: ACTOR1_ID,
          conversationId: membership.conversationId,
          lastStatusId: membership.statusId,
          lastStatusCreatedAt: membership.createdAt,
          unread: false,
          readAt: null,
          hiddenAt: null,
          createdAt: now,
          updatedAt: now
        }))
      )
      await knexDatabase('direct_conversation_statuses').insert([
        ...visibleConversations.map((membership) => ({
          conversationId: membership.conversationId,
          statusId: membership.statusId,
          createdAt: membership.createdAt,
          updatedAt: now
        })),
        {
          conversationId: 'conversation-stale-boundary',
          statusId: 'stale-fallback-status',
          createdAt: new Date(1000),
          updatedAt: now
        },
        {
          conversationId: 'conversation-after-boundary',
          statusId: 'after-boundary-status',
          createdAt: new Date(8000),
          updatedAt: now
        }
      ])

      const page = await database.getDirectConversations({
        actorId: ACTOR1_ID,
        limit: 20
      })

      expect(page).toHaveLength(20)
      expect(page.map((conversation) => conversation.lastStatusId)).toContain(
        'after-boundary-status'
      )
      expect(page[page.length - 1].lastStatusId).toEqual(
        'stale-fallback-status'
      )
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

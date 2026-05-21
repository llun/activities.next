import knex from 'knex'

import * as migration from '@/migrations/20260517002000_add_direct_conversations'
import * as recipientlessReplyMigration from '@/migrations/20260520000000_backfill_recipientless_direct_reply_conversations'

describe('direct conversations migration', () => {
  let database: knex.Knex

  const localActorId = 'https://local.test/users/alice'
  const remoteActorId = 'https://remote.test/users/bob'
  const statusId = 'https://remote.test/users/bob/statuses/direct-1'

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await database.schema.createTable('actors', (table) => {
      table.string('id').primary()
      table.string('privateKey')
    })
    await database.schema.createTable('statuses', (table) => {
      table.string('id').primary()
      table.string('url')
      table.string('type')
      table.string('actorId')
      table.string('reply')
      table.timestamp('createdAt')
    })
    await database.schema.createTable('recipients', (table) => {
      table.string('statusId')
      table.string('actorId')
      table.string('type')
    })
    await database.schema.createTable('timelines', (table) => {
      table.increments('id').primary()
      table.string('actorId')
      table.string('timeline')
      table.string('statusId')
      table.string('statusActorId')
      table.timestamp('createdAt', { useTz: true })
      table.timestamp('updatedAt', { useTz: true })

      table.unique(['actorId', 'timeline', 'statusId'], {
        indexName: 'timelines_actorId_timeline_statusId_unique'
      })
    })

    await database('actors').insert({
      id: localActorId,
      privateKey: 'local-private-key'
    })
    await database('statuses').insert({
      id: statusId,
      url: statusId,
      type: 'Note',
      actorId: remoteActorId,
      reply: '',
      createdAt: new Date('2026-05-17T00:00:00.000Z')
    })
    await database('recipients').insert({
      statusId,
      actorId: localActorId,
      type: 'to'
    })
    await database('timelines').insert([
      {
        actorId: localActorId,
        timeline: 'main',
        statusId,
        statusActorId: remoteActorId,
        createdAt: new Date('2026-05-17T00:00:00.000Z')
      },
      {
        actorId: localActorId,
        timeline: 'mention',
        statusId,
        statusActorId: remoteActorId,
        createdAt: new Date('2026-05-17T00:00:00.000Z')
      },
      {
        actorId: localActorId,
        timeline: 'noannounce',
        statusId,
        statusActorId: remoteActorId,
        createdAt: new Date('2026-05-17T00:00:00.000Z')
      }
    ])
  })

  afterEach(async () => {
    await database.destroy()
  })

  test('backfills direct timeline rows before removing legacy timeline rows', async () => {
    await migration.up(database)

    await expect(
      database('timelines')
        .where({ actorId: localActorId, statusId })
        .select('timeline')
        .orderBy('timeline', 'asc')
    ).resolves.toEqual([{ timeline: 'direct' }])
    await expect(
      database('direct_conversation_statuses').where({ statusId })
    ).resolves.toHaveLength(1)
  })

  test('leaves recipient-less statuses out of the direct backfill', async () => {
    const publicStatusId = 'https://local.test/users/alice/statuses/public-1'
    await database('statuses').insert({
      id: publicStatusId,
      url: publicStatusId,
      type: 'Note',
      actorId: localActorId,
      reply: '',
      createdAt: new Date('2026-05-16T00:00:00.000Z')
    })
    await database('timelines').insert({
      actorId: localActorId,
      timeline: 'main',
      statusId: publicStatusId,
      statusActorId: localActorId,
      createdAt: new Date('2026-05-16T00:00:00.000Z')
    })

    await migration.up(database)

    await expect(
      database('timelines')
        .where({ actorId: localActorId, statusId: publicStatusId })
        .select('timeline')
    ).resolves.toEqual([{ timeline: 'main' }])
    await expect(
      database('direct_conversation_statuses').where({
        statusId: publicStatusId
      })
    ).resolves.toHaveLength(0)
  })

  test('backfills recipientless direct replies to local non-direct statuses', async () => {
    const parentStatusId = 'https://local.test/users/alice/statuses/public-1'
    const parentStatusUrl = 'https://local.test/@alice/public-1'
    const replyStatusId =
      'https://remote.test/users/bob/statuses/recipientless-reply'
    await database('statuses').insert([
      {
        id: parentStatusId,
        url: parentStatusUrl,
        type: 'Note',
        actorId: localActorId,
        reply: '',
        createdAt: new Date('2026-05-16T00:00:00.000Z')
      },
      {
        id: replyStatusId,
        url: replyStatusId,
        type: 'Note',
        actorId: remoteActorId,
        reply: parentStatusUrl,
        createdAt: new Date('2026-05-17T01:00:00.000Z')
      }
    ])
    await database('recipients').insert([
      {
        statusId: parentStatusId,
        actorId: 'https://www.w3.org/ns/activitystreams#Public',
        type: 'to'
      },
      {
        statusId: parentStatusId,
        actorId: `${localActorId}/followers`,
        type: 'cc'
      }
    ])

    await migration.up(database)
    await expect(
      database('direct_conversation_statuses').where({
        statusId: replyStatusId
      })
    ).resolves.toHaveLength(0)

    await recipientlessReplyMigration.up(database)

    const [conversationStatus] = await database('direct_conversation_statuses')
      .where({ statusId: replyStatusId })
      .select<{ conversationId: string }[]>('conversationId')
    expect(conversationStatus).toBeDefined()
    await expect(
      database('direct_conversation_participants')
        .where({ conversationId: conversationStatus.conversationId })
        .select('actorId')
        .orderBy('actorId', 'asc')
    ).resolves.toEqual([{ actorId: localActorId }, { actorId: remoteActorId }])
    await expect(
      database('direct_conversation_memberships').where({
        actorId: localActorId,
        conversationId: conversationStatus.conversationId,
        lastStatusId: replyStatusId
      })
    ).resolves.toHaveLength(1)
    await expect(
      database('timelines').where({
        actorId: localActorId,
        statusId: replyStatusId,
        timeline: 'direct'
      })
    ).resolves.toHaveLength(1)
  })

  test('backfills chained recipientless direct replies in the same conversation', async () => {
    const parentStatusId = 'https://local.test/users/alice/statuses/public-2'
    const firstReplyStatusId =
      'https://remote.test/users/bob/statuses/recipientless-reply-1'
    const secondReplyStatusId =
      'https://remote.test/users/bob/statuses/recipientless-reply-2'

    await database('statuses').insert([
      {
        id: parentStatusId,
        url: parentStatusId,
        type: 'Note',
        actorId: localActorId,
        reply: '',
        createdAt: new Date('2026-05-16T00:00:00.000Z')
      },
      {
        id: firstReplyStatusId,
        url: firstReplyStatusId,
        type: 'Note',
        actorId: remoteActorId,
        reply: parentStatusId,
        createdAt: new Date('2026-05-17T01:00:00.000Z')
      },
      {
        id: secondReplyStatusId,
        url: secondReplyStatusId,
        type: 'Note',
        actorId: remoteActorId,
        reply: firstReplyStatusId,
        createdAt: new Date('2026-05-17T02:00:00.000Z')
      }
    ])
    await database('recipients').insert([
      {
        statusId: parentStatusId,
        actorId: 'https://www.w3.org/ns/activitystreams#Public',
        type: 'to'
      },
      {
        statusId: parentStatusId,
        actorId: `${localActorId}/followers`,
        type: 'cc'
      }
    ])

    await migration.up(database)
    await expect(
      database('direct_conversation_statuses')
        .whereIn('statusId', [firstReplyStatusId, secondReplyStatusId])
        .select('statusId')
    ).resolves.toHaveLength(0)

    await recipientlessReplyMigration.up(database)

    const conversationStatuses = await database('direct_conversation_statuses')
      .whereIn('statusId', [firstReplyStatusId, secondReplyStatusId])
      .select<
        { conversationId: string; statusId: string }[]
      >('conversationId', 'statusId')
      .orderBy('statusId', 'asc')
    const conversationIds = new Set(
      conversationStatuses.map((status) => status.conversationId)
    )
    const [conversationId] = conversationIds

    expect(conversationStatuses).toHaveLength(2)
    expect(conversationIds.size).toEqual(1)
    await expect(
      database('direct_conversations')
        .where({ id: conversationId, rootStatusId: firstReplyStatusId })
        .select('id')
    ).resolves.toHaveLength(1)
    await expect(
      database('direct_conversation_participants')
        .where({ conversationId })
        .select('actorId')
        .orderBy('actorId', 'asc')
    ).resolves.toEqual([{ actorId: localActorId }, { actorId: remoteActorId }])
    await expect(
      database('direct_conversation_memberships').where({
        actorId: localActorId,
        conversationId,
        lastStatusId: secondReplyStatusId
      })
    ).resolves.toHaveLength(1)
    await expect(
      database('timelines').where({
        actorId: localActorId,
        statusId: secondReplyStatusId,
        timeline: 'direct'
      })
    ).resolves.toHaveLength(1)
  })

  test('rollback restores legacy timeline rows from synced conversations', async () => {
    await migration.up(database)
    await migration.down(database)

    await expect(
      database('timelines')
        .where({ actorId: localActorId, statusId })
        .select('timeline')
        .orderBy('timeline', 'asc')
    ).resolves.toEqual([
      { timeline: 'home' },
      { timeline: 'main' },
      { timeline: 'mention' },
      { timeline: 'noannounce' }
    ])
    await expect(
      database.schema.hasTable('direct_conversations')
    ).resolves.toBe(false)
    await expect(
      database.schema.hasTable('direct_conversation_statuses')
    ).resolves.toBe(false)
  })
})

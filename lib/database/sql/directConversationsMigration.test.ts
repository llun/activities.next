import knex from 'knex'

import * as migration from '@/migrations/20260517002000_add_direct_conversations'

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

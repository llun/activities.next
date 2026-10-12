import knex from 'knex'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import * as migration from '@/migrations/20261005073054_add_likes_actor_created_at_index'

const INDEX = 'likes_actor_created_at_status_idx'

const indexColumns = async (instance: ReturnType<typeof knex>) => {
  const rows = (await instance.raw(
    `select name from pragma_index_info('${INDEX}') order by seqno`
  )) as { name: string }[]
  return rows.map((row) => row.name)
}

// GET /api/v1/favourites pages `likes` by actor, newest first. The primary key
// (statusId, actorId) cannot serve that, so without an
// (actorId, createdAt, statusId) index every page scans and sorts the table.
describe('likes (actorId, createdAt, statusId) index', () => {
  it('migration creates the actor-first index and down removes it', async () => {
    const instance = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    try {
      await instance.schema.createTable('likes', (table) => {
        table.string('statusId')
        table.string('actorId')
        table.timestamp('createdAt')
        table.primary(['statusId', 'actorId'])
      })

      await migration.up(instance)
      expect(await indexColumns(instance)).toEqual([
        'actorId',
        'createdAt',
        'statusId'
      ])

      await migration.down(instance)
      expect(await indexColumns(instance)).toEqual([])
    } finally {
      await instance.destroy()
    }
  })

  it('serves the favourites page query without a table scan or sort', async () => {
    const { database, instance } = getTestSQLDatabaseWithInstance()
    try {
      await database.migrate()
      expect(await indexColumns(instance)).toEqual([
        'actorId',
        'createdAt',
        'statusId'
      ])

      const plan = (await instance.raw(
        `explain query plan
         select * from likes where actorId = ? order by createdAt desc, statusId desc limit ?`,
        ['https://llun.test/users/actor', 20]
      )) as { detail: string }[]
      const details = plan.map((row) => row.detail).join('\n')

      expect(details).toContain(INDEX)
      expect(details).not.toContain('SCAN likes')
      expect(details).not.toContain('TEMP B-TREE')
    } finally {
      await database.destroy()
    }
  })

  it('is part of both reference schema dumps', () => {
    for (const file of ['schema.sql', 'schema.sqlite.sql']) {
      const dump = readFileSync(
        path.join(process.cwd(), 'migrations', file),
        'utf-8'
      )
      expect(dump).toContain(INDEX)
    }
  })
})

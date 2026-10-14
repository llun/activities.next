import { sql } from 'kysely'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { type Db } from '@/lib/database/kysely'
import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'

const INDEX = 'likes_actor_created_at_status_idx'

const INDEX_COLUMNS = `select name from pragma_index_info('${INDEX}') order by seqno`

const schemaIndexColumns = async (db: Db) => {
  const { rows } = await sql<{
    name: string
  }>`${sql.raw(INDEX_COLUMNS)}`.execute(db)
  return rows.map((row) => row.name)
}

// GET /api/v1/favourites pages `likes` by actor, newest first. The primary key
// (statusId, actorId) cannot serve that, so without an
// (actorId, createdAt, statusId) index every page scans and sorts the table.
describe('likes (actorId, createdAt, statusId) index', () => {
  it('serves the favourites page query without a table scan or sort', async () => {
    const { database, db } = getTestSQLDatabaseWithInstance()
    try {
      await database.migrate()
      expect(await schemaIndexColumns(db)).toEqual([
        'actorId',
        'createdAt',
        'statusId'
      ])

      const { rows: plan } = await sql<{ detail: string }>`
        explain query plan
        select * from likes where actorId = ${'https://llun.test/users/actor'}
        order by createdAt desc, statusId desc limit ${20}
      `.execute(db)
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

import knex from 'knex'

import * as migration from '@/migrations/20260822000000_reorder_status_announce_index'

// Pins the COLUMN ORDER of the announce lookup index, not merely its existence.
//
// Both orderings serve `hasActorAnnouncedStatus`, `getActorAnnounceStatus`,
// `getActorAnnouncedStatusId` and the batched announce hydration identically —
// those constrain all three columns — so every result-based assertion in the
// suite passes either way, and so does a test that only checks the index is
// there. What separates them is `getRebloggedBy`, which constrains `type` and
// `originalStatusId` but NOT `actorId`: with `actorId` in the middle,
// `originalStatusId` cannot be an index condition and the query degrades to
// scanning every Announce row. That regression is invisible to a functional
// test, which is why this one reads the index definition.
const OLD_INDEX = 'statuses_announce_actor_original_idx'
const NEW_INDEX = 'statuses_announce_original_actor_idx'

type SqliteIndexListRow = { name: string }
type SqliteIndexInfoRow = { seqno: number; name: string }

describe('status announce index order migration', () => {
  let database: knex.Knex

  const indexNames = async () => {
    const rows: SqliteIndexListRow[] = await database.raw(
      "PRAGMA index_list('statuses')"
    )
    return rows.map(({ name }) => name)
  }

  const indexColumns = async (indexName: string) => {
    const rows: SqliteIndexInfoRow[] = await database.raw(
      `PRAGMA index_info('${indexName}')`
    )
    return [...rows]
      .sort((first, second) => first.seqno - second.seqno)
      .map(({ name }) => name)
  }

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('statuses', (table) => {
      table.string('id').primary()
      table.string('type')
      table.string('actorId')
      table.string('originalStatusId')
      table.index(['type', 'actorId', 'originalStatusId'], OLD_INDEX)
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('leads the announce index with originalStatusId ahead of actorId', async () => {
    await migration.up(database)

    expect(await indexColumns(NEW_INDEX)).toEqual([
      'type',
      'originalStatusId',
      'actorId'
    ])
  })

  it('replaces the actorId-led index rather than leaving both behind', async () => {
    await migration.up(database)

    const names = await indexNames()
    expect(names).toContain(NEW_INDEX)
    expect(names).not.toContain(OLD_INDEX)
  })

  it('restores the actorId-led index on rollback', async () => {
    await migration.up(database)
    await migration.down(database)

    const names = await indexNames()
    expect(names).toContain(OLD_INDEX)
    expect(names).not.toContain(NEW_INDEX)
    expect(await indexColumns(OLD_INDEX)).toEqual([
      'type',
      'actorId',
      'originalStatusId'
    ])
  })
})

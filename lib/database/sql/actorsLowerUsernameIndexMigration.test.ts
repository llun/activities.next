import knex from 'knex'

import * as migration from '@/migrations/20260826120000_add_actors_lower_username_index'

// Pins the EXPRESSION the index is built on, not merely that an index exists.
//
// Nothing in the suite can catch a revert of this migration: the folded arm of
// `findActorRowByUsername` returns exactly the same rows whether it reads an
// index or sequentially scans `actors`, so every result-based test — including
// all of `usernameMatch.test.ts` — passes against a table with no index at all.
// What it costs is unbounded work on the requests least able to afford it (an
// unknown handle, the first lookup of a remote actor, account search), on a
// table that grows with every remote account this instance has ever seen.
//
// The index definition is read out of `sqlite_master` rather than through
// `PRAGMA index_info`, which reports a null column name for an expression and
// so cannot distinguish `lower(username)` from any other expression over the
// same table.
const INDEX_NAME = 'actors_lower_username_domain_idx'

type SqliteMasterRow = { sql: string | null }

describe('actors lower(username) index migration', () => {
  let database: knex.Knex

  const indexDefinition = async () => {
    const rows: SqliteMasterRow[] = await database.raw(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
      [INDEX_NAME]
    )
    return rows[0]?.sql ?? null
  }

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('actors', (table) => {
      table.string('id').primary()
      table.string('username')
      table.string('domain')
      table.unique(['username', 'domain'], {
        indexName: 'actors_username_domain_unique'
      })
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('indexes lower(username) with domain as the second column', async () => {
    await migration.up(database)

    const definition = await indexDefinition()
    expect(definition).toMatch(/lower\("username"\)/i)
    expect(definition).toMatch(/"domain"/i)
    // Order matters: the folded lookup constrains both columns, so `domain`
    // leading would leave the selective half off the index condition.
    expect(definition?.indexOf('lower')).toBeLessThan(
      definition?.indexOf('"domain"') ?? -1
    )
  })

  it('leaves the exact-match unique index in place', async () => {
    await migration.up(database)

    const rows: { name: string }[] = await database.raw(
      "PRAGMA index_list('actors')"
    )
    expect(rows.map(({ name }) => name)).toContain(
      'actors_username_domain_unique'
    )
  })

  // Non-unique on purpose. An instance may already hold local actors that
  // differ only by case, minted before usernames were normalized and left in
  // place because their ActivityPub ids are federated; a unique index would
  // refuse to build there. Case-collision is refused by `isUsernameExists`.
  it('does not refuse rows that differ only by case', async () => {
    await migration.up(database)

    await database('actors').insert([
      { id: 'https://test/users/Alice', username: 'Alice', domain: 'test' },
      { id: 'https://test/users/alice', username: 'alice', domain: 'test' }
    ])

    expect(await database('actors').count({ count: '*' }).first()).toEqual({
      count: 2
    })
  })

  // MySQL is skipped, not translated: its default collations already fold, so
  // `findActorRowByUsername` never issues the folded query there and nothing
  // would read the index — and the statement is not portable to it anyway
  // (`((lower(username)), domain)`, no `IF NOT EXISTS` on CREATE INDEX,
  // backtick quoting, functional indexes only from 8.0.13, and never in
  // MariaDB, which the `mysql2` client also connects to).
  it.each([{ client: 'mysql' }, { client: 'mysql2' }])(
    'is a no-op on the $client client',
    async ({ client }) => {
      const asMySQL = {
        ...database,
        client: { ...database.client, config: { client } }
      } as unknown as knex.Knex

      await expect(migration.up(asMySQL)).resolves.not.toThrow()
      await expect(migration.down(asMySQL)).resolves.not.toThrow()
      expect(await indexDefinition()).toBeNull()
    }
  )

  it('drops the index on rollback', async () => {
    await migration.up(database)
    await migration.down(database)

    expect(await indexDefinition()).toBeNull()
  })

  it('is safe to re-run over an index that already exists', async () => {
    await migration.up(database)
    await expect(migration.up(database)).resolves.not.toThrow()
  })
})

import knex, { Knex } from 'knex'

import * as migration from '@/migrations/20260821120000_normalize_empty_actor_private_key'

describe('normalize empty actor private key migration', () => {
  let database: Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await database.schema.createTable('actors', (table) => {
      table.string('id').primary()
      table.text('privateKey')
      table.text('publicKey')
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('rewrites empty-string keys to null and leaves real keys and nulls alone', async () => {
    await database('actors').insert([
      { id: 'empty', privateKey: '', publicKey: 'public-empty' },
      { id: 'real', privateKey: 'a real PEM key', publicKey: 'public-real' },
      { id: 'null', privateKey: null, publicKey: 'public-null' }
    ])

    await migration.up(database)

    const rows = await database('actors').orderBy('id')
    expect(rows).toEqual([
      { id: 'empty', privateKey: null, publicKey: 'public-empty' },
      { id: 'null', privateKey: null, publicKey: 'public-null' },
      { id: 'real', privateKey: 'a real PEM key', publicKey: 'public-real' }
    ])
  })

  it('does not treat a whitespace-only key as empty', async () => {
    // Only the exact empty string is the marker the remote-recording paths
    // wrote. A key that is whitespace is a corrupt row, not this bug, and
    // silently nulling it would hide that.
    await database('actors').insert({ id: 'space', privateKey: ' ' })

    await migration.up(database)

    const row = await database('actors').where('id', 'space').first()
    expect(row.privateKey).toBe(' ')
  })

  it('is idempotent', async () => {
    await database('actors').insert({ id: 'empty', privateKey: '' })

    await migration.up(database)
    await migration.up(database)

    const row = await database('actors').where('id', 'empty').first()
    expect(row.privateKey).toBeNull()
  })

  it('does not restore the empty string on rollback', async () => {
    // `down` is intentionally a no-op: '' and NULL both mean "no signing key",
    // and writing '' back would reinstate the bug this migration exists to
    // remove. Asserting the value stays NULL pins that intent — a `down` that
    // "restored" the previous state would pass a bare resolves-without-throwing
    // check.
    await database('actors').insert({ id: 'empty', privateKey: '' })
    await migration.up(database)

    await expect(migration.down(database)).resolves.toBeUndefined()

    const row = await database('actors').where('id', 'empty').first()
    expect(row.privateKey).toBeNull()
  })
})

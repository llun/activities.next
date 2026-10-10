import type { Knex } from 'knex'

import { kyselyFor } from '@/lib/database/kysely'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'

// (createdAt, id) keyset comparison, checked on SQLite and, under
// TEST_DATABASE_TYPE=pg, PostgreSQL.
describe('pastKeyset', () => {
  let database: Database
  let instance: Knex

  const base = Date.UTC(2026, 0, 1)
  const rows = [
    { id: 'a', at: base },
    { id: 'b', at: base + 1000 },
    { id: 'c', at: base + 1000 },
    { id: 'd', at: base + 2000 }
  ]

  beforeAll(async () => {
    const test = getTestDatabaseWithInstance()
    database = test.database
    instance = test.instance
    await test.prepare()
    await database.migrate()
    await instance('actor_domain_blocks').insert(
      rows.map(({ id, at }) => ({
        id,
        actorId: 'https://example.com/users/keyset',
        domain: `${id}.example`,
        createdAt: new Date(at),
        updatedAt: new Date(at)
      }))
    )
  })

  afterAll(async () => {
    await database.destroy()
  })

  const ids = async (operator: '<' | '>', cursor: (typeof rows)[number]) => {
    const found = await kyselyFor(instance)
      .selectFrom('actor_domain_blocks')
      .select('id')
      .where((eb) =>
        pastKeyset(
          eb,
          { createdAt: cursor.at, tieBreaker: cursor.id },
          operator,
          'id'
        )
      )
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute()
    return found.map((row) => row.id)
  }

  it('returns rows after the cursor in (createdAt, id) order', async () => {
    expect(await ids('>', rows[1])).toEqual(['c', 'd'])
  })

  it('returns rows before the cursor in (createdAt, id) order', async () => {
    expect(await ids('<', rows[2])).toEqual(['a', 'b'])
  })

  it('accepts a Date createdAt', async () => {
    const found = await kyselyFor(instance)
      .selectFrom('actor_domain_blocks')
      .select('id')
      .where((eb) =>
        pastKeyset(
          eb,
          { createdAt: new Date(rows[3].at), tieBreaker: 'd' },
          '<',
          'id'
        )
      )
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute()
    expect(found.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('type-checks the tie-breaker column against the queried table', () => {
    // Compile-time only: the builders are never executed.
    const db = kyselyFor(instance)
    const c = { createdAt: 0, tieBreaker: 'x' }
    db.selectFrom('likes').where((eb) =>
      // @ts-expect-error a case typo PostgreSQL would reject
      pastKeyset(eb, c, '<', 'statusID')
    )
    db.selectFrom('likes').where((eb) =>
      // @ts-expect-error a column of a table the query does not select from
      pastKeyset(eb, c, '<', 'statuses.id')
    )
    db.selectFrom('markers').where((eb) =>
      // @ts-expect-error markers has no createdAt column
      pastKeyset(eb, c, '<', 'id')
    )
  })
})

import knex, { Knex } from 'knex'

import { isMySQLClient } from '@/lib/database/sql/utils/knex'
import { findActorRowByUsername } from '@/lib/database/sql/utils/usernameMatch'

// The MySQL branch of `findActorRowByUsername`, in its own file because a
// module mock is file-wide and `usernameMatch.test.ts` must exercise the real
// dialect detection.
//
// On MySQL the exact arm has already folded — the default collations
// (`utf8mb4_0900_ai_ci` and friends) are case-insensitive, and so therefore is
// `actors_username_domain_unique`, which means a case-colliding pair cannot
// exist there at all. The folded arm would find nothing the first query did not
// and would find it by SCANNING `actors`, because its functional index is
// deliberately not created on MySQL (MariaDB has no functional indexes and
// MySQL only gained them in 8.0.13). Skipping it is what keeps a 404 on MySQL
// from costing a table scan.
//
// Driven by mocking the dialect predicate rather than by standing up a MySQL
// server: what is under test is the composition
// `if (exactMatch || isMySQLClient(database)) return exactMatch`, and a real
// MySQL would additionally fold in its collation and hide the difference.
vi.mock('@/lib/database/sql/utils/knex', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/database/sql/utils/knex')
  >('@/lib/database/sql/utils/knex')
  return { ...actual, isMySQLClient: vi.fn() }
})

describe('findActorRowByUsername on a MySQL client', () => {
  let database: Knex
  let statements: string[]

  beforeEach(async () => {
    // A vi.mock factory's vi.fn() is NOT reset by restoreAllMocks, so its
    // implementation and call history would otherwise leak across tests.
    vi.mocked(isMySQLClient).mockReset()
    vi.mocked(isMySQLClient).mockReturnValue(false)

    statements = []
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    database.on('query', ({ sql }: { sql: string }) => statements.push(sql))

    await database.schema.createTable('actors', (table) => {
      table.string('id').primary()
      table.string('username')
      table.string('domain')
      table.timestamp('createdAt')
    })
    await database('actors').insert({
      id: 'https://test/users/MixedCase',
      username: 'MixedCase',
      domain: 'test',
      createdAt: new Date(0)
    })
    statements = []
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('issues the folded query on a miss for a non-MySQL client', async () => {
    const row = await findActorRowByUsername(database, {
      username: 'mixedcase',
      domain: 'test'
    })

    expect(row?.username).toBe('MixedCase')
    expect(statements).toHaveLength(2)
    expect(statements[1]).toContain('lower')
  })

  it('stops after the exact query on a miss for a MySQL client', async () => {
    vi.mocked(isMySQLClient).mockReturnValue(true)

    const row = await findActorRowByUsername(database, {
      username: 'mixedcase',
      domain: 'test'
    })

    // SQLite is case-sensitive, so the row is genuinely not found here. On a
    // real MySQL the exact arm would have matched it in the collation; what
    // this pins is that no SECOND query was issued.
    expect(row).toBeUndefined()
    expect(statements).toHaveLength(1)
    expect(statements[0]).not.toContain('lower')
  })

  it('never reaches the dialect check when the exact query hits', async () => {
    vi.mocked(isMySQLClient).mockReturnValue(true)

    const row = await findActorRowByUsername(database, {
      username: 'MixedCase',
      domain: 'test'
    })

    expect(row?.username).toBe('MixedCase')
    expect(statements).toHaveLength(1)
  })
})

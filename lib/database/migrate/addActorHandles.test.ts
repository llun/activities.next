import { sql } from 'kysely'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { down, up } from '@/migrations/20261025141323_add_actor_handles'

// The actor_handles migration: the table and its indexes, and the backfill
// that gives every account-backed local actor its current ledger row while
// skipping remote actors and younger case twins.
describe('20261025141323_add_actor_handles', () => {
  const testDb = createTestDatabase()

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const actorRow = (
    id: string,
    username: string,
    overrides: Record<string, unknown> = {}
  ) => ({
    id,
    username,
    domain: TEST_DOMAIN,
    ...overrides
  })

  const localActor = (username: string, createdAt: Date) =>
    actorRow(`https://${TEST_DOMAIN}/users/${username}`, username, {
      accountId: `account-${username}`,
      privateKey: `private-key-${username}`,
      publicKey: `public-key-${username}`,
      createdAt
    })

  const seedActors = async () => {
    await testDb.db
      .insertInto('accounts')
      .values([
        { id: 'account-local-old', email: 'local-old@test.llun.dev' },
        { id: 'account-LOCAL-OLD', email: 'LOCAL-OLD@test.llun.dev' }
      ])
      .execute()
    await testDb.db
      .insertInto('actors')
      .values([
        localActor('local-old', new Date('2024-01-01T00:00:00.000Z')),
        // Younger case twin of local-old: the backfill skips it.
        localActor('LOCAL-OLD', new Date('2024-06-01T00:00:00.000Z')),
        // No account: not backfilled even with a private key.
        actorRow(`https://${TEST_DOMAIN}/users/no-account`, 'no-account', {
          privateKey: 'private-key',
          publicKey: 'public-key',
          createdAt: new Date('2024-02-01T00:00:00.000Z')
        }),
        // Remote: no private key.
        actorRow('https://remote.test/users/remote', 'remote', {
          createdAt: new Date('2024-03-01T00:00:00.000Z')
        })
      ])
      .execute()
  }

  const ledgerRows = async () =>
    (await testDb.db.selectFrom('actor_handles').selectAll().execute()).sort(
      (a, b) => a.actorId.localeCompare(b.actorId)
    )

  it('backfills one row per account-backed local actor, skipping remote actors and the younger case twin', async () => {
    await down(testDb.db)
    await seedActors()

    await up(testDb.db)

    const rows = await ledgerRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorId: `https://${TEST_DOMAIN}/users/local-old`,
      username: 'local-old',
      domain: TEST_DOMAIN,
      replacedAt: null
    })
    // The backfilled row's createdAt is the actor's createdAt.
    expect(new Date(rows[0].createdAt).toISOString()).toBe(
      '2024-01-01T00:00:00.000Z'
    )
  })

  it('inserts nothing new when up runs a second time', async () => {
    await up(testDb.db)

    expect(await ledgerRows()).toHaveLength(1)
  })

  it('pages by keyset, not offset, when actors exceed one page', async () => {
    await down(testDb.db)
    const pagingCreated = new Date('2024-05-01T00:00:00.000Z')
    await testDb.db
      .insertInto('accounts')
      .values(
        Array.from({ length: 250 }, (_, index) => ({
          id: `account-paging-${String(index).padStart(3, '0')}`,
          email: `paging-${index}@test.llun.dev`
        }))
      )
      .execute()
    // One shared createdAt: the second page starts INSIDE the timestamp, so
    // only the (createdAt, id) keyset can read every actor exactly once.
    await testDb.db
      .insertInto('actors')
      .values(
        Array.from({ length: 250 }, (_, index) =>
          localActor(`paging-${String(index).padStart(3, '0')}`, pagingCreated)
        )
      )
      .execute()

    await up(testDb.db)

    const rows = await ledgerRows()
    expect(rows).toHaveLength(251)
    expect(new Set(rows.map((row) => row.actorId)).size).toBe(251)
  })

  it('drops the table on down', async () => {
    await down(testDb.db)

    const tables = await testDb.db.introspection.getTables()
    expect(tables.some(({ name }) => name === 'actor_handles')).toBe(false)

    // Leave the migration's own state in place for the next test file run.
    await up(testDb.db)
  })

  it.runIf(testDb.backend === 'sqlite')(
    'leaves no actor_handles index behind on SQLite',
    async () => {
      await down(testDb.db)
      const { rows } = await sql<{ name: string }>`
        select name from sqlite_master
        where type = 'index' and name like 'actor_handles%'
      `.execute(testDb.db)
      expect(rows).toEqual([])

      // Leave the migration's own state in place for the next test file run.
      await up(testDb.db)
    }
  )
})

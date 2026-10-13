import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { holdTransaction } from '@/lib/database/testing/heldTransaction'

describe('holdTransaction', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  const countCounters = async (id: string) =>
    (
      await db
        .selectFrom('counters')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).count

  const insertCounter = (writer: typeof db, id: string) =>
    writer
      .insertInto('counters')
      .values({ id, value: 1, createdAt: new Date(), updatedAt: new Date() })
      .execute()

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('keeps the transaction open, and commits what it wrote', async () => {
    const held = await holdTransaction(db)
    await insertCounter(held.trx, 'held-commit')
    if (testDb.backend === 'pg') {
      // Another connection does not see the write yet. On SQLite the one
      // connection belongs to the transaction, so nothing else runs until it
      // ends.
      await expect(countCounters('held-commit')).resolves.toBe(0)
    }
    await held.commit()

    await expect(countCounters('held-commit')).resolves.toBe(1)
  })

  it('rolls back what it wrote', async () => {
    const held = await holdTransaction(db)
    await insertCounter(held.trx, 'held-rollback')
    await held.rollback()

    await expect(countCounters('held-rollback')).resolves.toBe(0)
  })
})

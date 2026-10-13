import { ParseJSONResultsPlugin, sql } from 'kysely'

import { createDatabaseConnection } from '@/lib/database/connection'
import {
  type Db,
  TransactionScopeError,
  inTransaction,
  isInTransaction
} from '@/lib/database/kysely'
import {
  createTestDatabase,
  getTestDatabaseConfig
} from '@/lib/database/testing/createTestDatabase'

// The root instance inside a transaction of the same database: on SQLite
// (one connection, where it would wait forever) and, under
// TEST_DATABASE_TYPE=pg, on PostgreSQL (where it would run outside the
// transaction). Each refusal must come at once; Vitest's timeout would catch
// a hang.
describe('root instance inside inTransaction', () => {
  const testDb = createTestDatabase()
  const { db } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const like = (actorId: string) => ({
    actorId,
    statusId: 'guard-status',
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const likedActorIds = async (prefix: string) =>
    (
      await db
        .selectFrom('likes')
        .select('actorId')
        .where('actorId', 'like', `${prefix}%`)
        .orderBy('actorId')
        .execute()
    ).map((row) => row.actorId)

  it('refuses a root query inside the transaction, at once', async () => {
    await expect(
      inTransaction(db, async (trx) => {
        await trx.insertInto('likes').values(like('refused-trx')).execute()
        await db.selectFrom('likes').selectAll().execute()
      })
    ).rejects.toThrow(TransactionScopeError)
    // The transaction rolled back with the error.
    expect(await likedActorIds('refused-')).toEqual([])
  })

  it('names the transaction to use instead', async () => {
    await expect(
      inTransaction(db, () => db.selectFrom('likes').selectAll().execute())
    ).rejects.toThrow(/Use the transaction passed to the callback instead/)
  })

  it('refuses a root transaction inside the transaction', async () => {
    await expect(
      inTransaction(db, () => db.transaction().execute(async () => undefined))
    ).rejects.toThrow(TransactionScopeError)
  })

  it('refuses root work started without await inside the transaction', async () => {
    let started: Promise<unknown> = Promise.resolve()
    await inTransaction(db, async () => {
      started = db.selectFrom('likes').selectAll().execute()
      started.catch(() => undefined)
    })
    await expect(started).rejects.toThrow(TransactionScopeError)
  })

  it('runs the transaction statements and commits them', async () => {
    await inTransaction(db, async (trx) => {
      await trx.insertInto('likes').values(like('commit-one')).execute()
      await trx.insertInto('likes').values(like('commit-two')).execute()
    })
    expect(await likedActorIds('commit-')).toEqual(['commit-one', 'commit-two'])
  })

  it('lets the root instance run again once the transaction has ended', async () => {
    await inTransaction(db, async (trx) => {
      await trx.insertInto('likes').values(like('after-trx')).execute()
    })
    await expect(likedActorIds('after-')).resolves.toEqual(['after-trx'])
  })

  it('reuses the transaction it is given, including a derived instance', async () => {
    await inTransaction(db, async (trx) => {
      const derived = trx.withPlugin(new ParseJSONResultsPlugin())
      expect(isInTransaction(derived)).toBe(true)
      await inTransaction(derived, async (inner) => {
        expect(inner).toBe(derived)
        await inner.insertInto('likes').values(like('nested-one')).execute()
      })
    })
    expect(await likedActorIds('nested-')).toEqual(['nested-one'])
  })

  it('refuses a root instance derived from the guarded one', async () => {
    const derived = db.withPlugin(new ParseJSONResultsPlugin())
    expect(isInTransaction(derived)).toBe(false)
    await expect(
      inTransaction(db, () => derived.selectFrom('likes').selectAll().execute())
    ).rejects.toThrow(TransactionScopeError)
  })

  it('does not refuse another database', async () => {
    const other = createDatabaseConnection(getTestDatabaseConfig('sqlite'))
    try {
      await inTransaction(db, async () => {
        const { rows } = await sql<{ one: number }>`select 1 as one`.execute(
          other.db
        )
        expect(rows).toEqual([{ one: 1 }])
      })
    } finally {
      await other.destroy()
    }
  })

  it('does not refuse other async contexts while the transaction is open', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = () => {}
    const inside = new Promise<void>((resolve) => {
      entered = resolve
    })
    const transaction = inTransaction(db, async (trx: Db) => {
      await trx.insertInto('likes').values(like('context-trx')).execute()
      entered()
      await gate
    })
    await inside
    // Another request: it waits for SQLite's only connection, or gets
    // another pooled one on PostgreSQL, instead of being refused.
    const elsewhere = db.selectFrom('likes').select('actorId').execute()
    release()
    await transaction
    await expect(elsewhere).resolves.toBeDefined()
  })
})

import type { Knex } from 'knex'

import { type Db, inTransaction, kyselyFor } from '@/lib/database/kysely'
import { inSavepoint } from '@/lib/database/kysely/savepoint'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'

// A failed statement caught inside a transaction, on SQLite and, under
// TEST_DATABASE_TYPE=pg, PostgreSQL (which aborts the whole transaction on any
// statement error unless it ran behind a savepoint).
describe('inSavepoint', () => {
  const ACTOR = 'https://example.com/users/savepoint'

  let database: Database
  let instance: Knex
  let db: Db

  beforeAll(async () => {
    const test = getTestDatabaseWithInstance()
    database = test.database
    instance = test.instance
    await test.prepare()
    await database.migrate()
    db = kyselyFor(instance)
  })

  afterAll(async () => {
    await database.destroy()
  })

  const dismiss = (trx: Db, targetActorId: string) =>
    trx
      .insertInto('suggestion_dismissals')
      .values({ actorId: ACTOR, targetActorId, createdAt: new Date() })
      .execute()

  const stored = async () => {
    const rows = await db
      .selectFrom('suggestion_dismissals')
      .select('targetActorId')
      .where('actorId', '=', ACTOR)
      .orderBy('targetActorId')
      .execute()
    return rows.map((row) => row.targetActorId)
  }

  beforeEach(async () => {
    await db.deleteFrom('suggestion_dismissals').execute()
  })

  it('returns the callback result and keeps its writes', async () => {
    const result = await inTransaction(db, (trx) =>
      inSavepoint(trx, async () => {
        await dismiss(trx, 'kept')
        return 'done'
      })
    )

    expect(result).toBe('done')
    expect(await stored()).toEqual(['kept'])
  })

  it('lets the transaction carry on after a unique violation it caught', async () => {
    await inTransaction(db, async (trx) => {
      await dismiss(trx, 'a')
      await expect(inSavepoint(trx, () => dismiss(trx, 'a'))).rejects.toSatisfy(
        isUniqueConstraintError
      )
      // Without the savepoint PostgreSQL rejects every statement from here on
      // ("current transaction is aborted").
      await dismiss(trx, 'b')
    })

    expect(await stored()).toEqual(['a', 'b'])
  })

  it('rolls back what the failed callback wrote, and nothing else', async () => {
    await inTransaction(db, async (trx) => {
      await dismiss(trx, 'before')
      await expect(
        inSavepoint(trx, async () => {
          await dismiss(trx, 'inside')
          throw new Error('stop')
        })
      ).rejects.toThrow('stop')
      await dismiss(trx, 'after')
    })

    expect(await stored()).toEqual(['after', 'before'])
  })

  it('nests, and rolls back with the transaction when that fails', async () => {
    await expect(
      inTransaction(db, async (trx) => {
        await inSavepoint(trx, async () => {
          await dismiss(trx, 'outer')
          await expect(
            inSavepoint(trx, async () => {
              await dismiss(trx, 'inner')
              throw new Error('inner')
            })
          ).rejects.toThrow('inner')
        })
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')

    expect(await stored()).toEqual([])
  })

  it('refuses a root instance, whose statements may use different connections', async () => {
    await expect(inSavepoint(db, () => dismiss(db, 'a'))).rejects.toThrow(
      'needs the transaction'
    )
    expect(await stored()).toEqual([])
  })

  it('works on the Kysely view of a Knex transaction', async () => {
    await instance.transaction(async (knexTrx) => {
      const trx = kyselyFor(knexTrx)
      await dismiss(trx, 'a')
      await expect(inSavepoint(trx, () => dismiss(trx, 'a'))).rejects.toSatisfy(
        isUniqueConstraintError
      )
      await dismiss(trx, 'b')
    })

    expect(await stored()).toEqual(['a', 'b'])
  })
})

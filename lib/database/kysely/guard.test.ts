import type { Knex } from 'knex'

import { MixedDatabaseTransactionError, kyselyFor } from '@/lib/database/kysely'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'
import { createDeferred } from '@/lib/testing/deferred'

// Knex and Kysely share one pool. These pin what happens when the two meet
// inside a transaction, on SQLite (one pooled connection, where a wrong turn
// used to deadlock or silently lose a write) and, under
// TEST_DATABASE_TYPE=pg, on PostgreSQL.
describe('mixing Knex and Kysely transactions', () => {
  let database: Database
  let instance: Knex

  beforeAll(async () => {
    const test = getTestDatabaseWithInstance()
    database = test.database
    instance = test.instance
    await test.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  const like = (actorId: string) => ({
    actorId,
    statusId: 'guard-status',
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const likedActorIds = async (prefix: string) =>
    (
      await instance('likes')
        .select('actorId')
        .where('actorId', 'like', `${prefix}%`)
        .orderBy('actorId')
    ).map((row: { actorId: string }) => row.actorId)

  it('commits kyselyFor(trx) writes with the Knex transaction', async () => {
    await instance.transaction(async (trx) => {
      await trx('likes').insert(like('commit-knex'))
      await kyselyFor(trx)
        .insertInto('likes')
        .values(like('commit-kysely'))
        .execute()
    })
    expect(await likedActorIds('commit-')).toEqual([
      'commit-knex',
      'commit-kysely'
    ])
  })

  it('rolls kyselyFor(trx) writes back with the Knex transaction', async () => {
    await expect(
      instance.transaction(async (trx) => {
        await trx('likes').insert(like('rollback-knex'))
        await kyselyFor(trx)
          .insertInto('likes')
          .values(like('rollback-kysely'))
          .execute()
        throw new Error('roll back')
      })
    ).rejects.toThrow('roll back')
    expect(await likedActorIds('rollback-')).toEqual([])
  })

  it('refuses to open a transaction on kyselyFor(trx)', async () => {
    await instance.transaction(async (trx) => {
      await expect(
        kyselyFor(trx)
          .transaction()
          .execute(async () => undefined)
      ).rejects.toThrow(MixedDatabaseTransactionError)
    })
  })

  it('refuses kyselyFor(trx) after the Knex transaction finished', async () => {
    let finished: Knex.Transaction | undefined
    await instance.transaction(async (trx) => {
      finished = trx
    })
    await expect(
      kyselyFor(finished as Knex.Transaction)
        .selectFrom('likes')
        .selectAll()
        .execute()
    ).rejects.toThrow('Transaction query already complete')
  })

  // Spike failure 3: deadlocked on SQLite's single pooled connection.
  it('fails fast when the root Kysely instance queries inside a Knex transaction', async () => {
    await instance.transaction(async (trx) => {
      await trx('likes').insert(like('root-query-knex'))
      await expect(
        kyselyFor(instance).selectFrom('likes').selectAll().execute()
      ).rejects.toThrow(/kyselyFor\(trx\)/)
    })
    // The Knex transaction itself is unaffected.
    expect(await likedActorIds('root-query-')).toEqual(['root-query-knex'])
  })

  // Spike failure 2: "cannot start a transaction within a transaction".
  it('fails fast when a root Kysely transaction opens inside a Knex transaction', async () => {
    await instance.transaction(async () => {
      await expect(
        kyselyFor(instance)
          .transaction()
          .execute(async () => undefined)
      ).rejects.toThrow(MixedDatabaseTransactionError)
    })
  })

  // Spike failure 1, from inside: the Knex write was rolled back with the
  // Kysely transaction without any error.
  it('fails fast when a root Knex query runs inside a Kysely transaction', async () => {
    await expect(
      kyselyFor(instance)
        .transaction()
        .execute(async (trx) => {
          await trx.insertInto('likes').values(like('inside-kysely')).execute()
          await instance('likes').insert(like('inside-knex'))
        })
    ).rejects.toThrow(MixedDatabaseTransactionError)
    expect(await likedActorIds('inside-')).toEqual([])
  })

  // Spike failure 1, from another request: the Knex write now waits for the
  // connection and lands after the Kysely transaction rolls back.
  it('keeps a concurrent Knex write when a Kysely transaction rolls back', async () => {
    const inserted = createDeferred<void>()
    const release = createDeferred<void>()
    const kyselyWork = kyselyFor(instance)
      .transaction()
      .execute(async (trx) => {
        await trx
          .insertInto('likes')
          .values(like('concurrent-kysely'))
          .execute()
        inserted.resolve()
        await release.promise
        throw new Error('roll back')
      })

    await inserted.promise
    const knexWrite = instance('likes').insert(like('concurrent-knex'))
    const knexDone = knexWrite.then(() => undefined)
    release.resolve()

    await expect(kyselyWork).rejects.toThrow('roll back')
    await knexDone
    expect(await likedActorIds('concurrent-')).toEqual(['concurrent-knex'])
  })

  it('fails fast when the root Kysely instance is used inside its own transaction', async () => {
    await expect(
      kyselyFor(instance)
        .transaction()
        .execute(async () => {
          await kyselyFor(instance).selectFrom('likes').selectAll().execute()
        })
    ).rejects.toThrow(/callback instead/)
  })

  it('refuses Kysely controlled transactions', async () => {
    await expect(
      kyselyFor(instance).startTransaction().execute()
    ).rejects.toThrow(/db\.transaction\(\)\.execute/)
    // The connection went back to the pool.
    await expect(instance('likes').count()).resolves.toBeDefined()
  })
})

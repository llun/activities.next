import crypto from 'crypto'
import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { CounterKey, getCounterValue } from '@/lib/database/sql/utils/counter'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

describe('BlockDatabase', () => {
  let knexDatabase: Knex
  let database: Database

  beforeAll(async () => {
    knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    database = getSQLDatabase(knexDatabase)
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  const targetActorId = () =>
    `https://remote.test/users/blocked-${crypto.randomUUID()}`

  it('creates blocks idempotently and updates block counters once', async () => {
    const target = targetActorId()
    const uri = `${ACTOR1_ID}#blocks/${crypto.randomUUID()}`

    const first = await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: target,
      uri
    })
    const second = await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: target,
      uri: `${ACTOR1_ID}#blocks/${crypto.randomUUID()}`
    })

    expect(second).toEqual(first)
    expect(
      await database.isBlocking({ actorId: ACTOR1_ID, targetActorId: target })
    ).toBe(true)
    expect(
      await database.isEitherBlocking({ actorIdA: target, actorIdB: ACTOR1_ID })
    ).toBe(true)
    expect(
      await getCounterValue(knexDatabase, CounterKey.totalBlocking(ACTOR1_ID))
    ).toBe(1)
    expect(
      await getCounterValue(knexDatabase, CounterKey.totalBlockedBy(target))
    ).toBe(1)
  })

  it('requires sparse undo deletion to match the block owner', async () => {
    const target = targetActorId()
    const uri = `${ACTOR1_ID}#blocks/${crypto.randomUUID()}`
    const block = await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId: target,
      uri
    })

    await expect(
      database.deleteBlockByUri({
        actorId: 'https://remote.test/users/not-owner',
        uri
      })
    ).resolves.toBeNull()
    await expect(database.getBlockByUri({ uri })).resolves.toEqual(block)

    await expect(
      database.deleteBlockByUri({
        actorId: ACTOR1_ID,
        uri
      })
    ).resolves.toEqual(block)
    await expect(database.getBlockByUri({ uri })).resolves.toBeNull()
  })
})

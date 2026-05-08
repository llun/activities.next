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

  it('paginates blocks by creation time with stable UUID cursors', async () => {
    const actorId = `https://remote.test/users/blocker-${crypto.randomUUID()}`
    const targets = await Promise.all(
      [0, 1, 2, 3, 4].map(async () => {
        const target = targetActorId()
        return database.createBlock({
          actorId,
          targetActorId: target,
          uri: `${actorId}#blocks/${crypto.randomUUID()}`
        })
      })
    )
    await Promise.all(
      targets.map((block, index) =>
        knexDatabase('blocks')
          .where({ id: block.id })
          .update({ createdAt: new Date(2026, 0, 1, 0, 0, index) })
      )
    )

    const [firstPage, secondPage, newerPage] = await Promise.all([
      database.getBlocks({ actorId, limit: 2 }),
      database.getBlocks({ actorId, limit: 2, maxId: targets[1].id }),
      database.getBlocks({ actorId, limit: 2, minId: targets[0].id })
    ])

    expect(firstPage.map((block) => block.id)).toEqual([
      targets[4].id,
      targets[3].id
    ])
    expect(secondPage.map((block) => block.id)).toEqual([targets[0].id])
    expect(newerPage.map((block) => block.id)).toEqual([
      targets[2].id,
      targets[1].id
    ])
  })

  it('uses the UUID tie-breaker when block creation timestamps match', async () => {
    const actorId = `https://remote.test/users/tie-${crypto.randomUUID()}`
    const blocks = await Promise.all(
      [0, 1, 2].map(async () => {
        const target = targetActorId()
        return database.createBlock({
          actorId,
          targetActorId: target,
          uri: `${actorId}#blocks/${crypto.randomUUID()}`
        })
      })
    )
    const tiedCreatedAt = new Date(2026, 0, 2, 0, 0, 0)
    await Promise.all(
      blocks.map((block) =>
        knexDatabase('blocks')
          .where({ id: block.id })
          .update({ createdAt: tiedCreatedAt })
      )
    )

    const expectedIds = blocks
      .map((block) => block.id)
      .sort()
      .reverse()
    const firstPage = await database.getBlocks({ actorId, limit: 2 })
    const secondPage = await database.getBlocks({
      actorId,
      limit: 2,
      maxId: firstPage[1].id
    })

    expect(firstPage.map((block) => block.id)).toEqual(expectedIds.slice(0, 2))
    expect(secondPage.map((block) => block.id)).toEqual(expectedIds.slice(2))
  })

  it('ignores unknown block cursors', async () => {
    const actorId = `https://remote.test/users/cursor-${crypto.randomUUID()}`
    const block = await database.createBlock({
      actorId,
      targetActorId: targetActorId(),
      uri: `${actorId}#blocks/${crypto.randomUUID()}`
    })

    await expect(
      database.getBlocks({
        actorId,
        limit: 2,
        maxId: crypto.randomUUID()
      })
    ).resolves.toEqual([block])
  })

  it('returns block relations for bulk filtering in either direction', async () => {
    const actorId = `https://remote.test/users/reader-${crypto.randomUUID()}`
    const blockedTarget = targetActorId()
    const blockingTarget = targetActorId()
    const unrelatedTarget = targetActorId()

    await Promise.all([
      database.createBlock({
        actorId,
        targetActorId: blockedTarget,
        uri: `${actorId}#blocks/${crypto.randomUUID()}`
      }),
      database.createBlock({
        actorId: blockingTarget,
        targetActorId: actorId,
        uri: `${blockingTarget}#blocks/${crypto.randomUUID()}`
      })
    ])

    await expect(
      database.getBlockRelations({
        actorIds: [actorId],
        targetActorIds: [blockedTarget, blockingTarget, unrelatedTarget]
      })
    ).resolves.toIncludeSameMembers([
      { actorId, targetActorId: blockedTarget },
      { actorId: blockingTarget, targetActorId: actorId }
    ])
  })
})

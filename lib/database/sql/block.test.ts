import crypto from 'crypto'
import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { BlockSQLDatabaseMixin } from '@/lib/database/sql/block'
import { CounterKey, getCounterValue } from '@/lib/database/sql/utils/counter'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { BlockRelation } from '@/lib/types/database/operations'

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
    const sincePage = await database.getBlocks({
      actorId,
      limit: 2,
      sinceId: targets[0].id
    })

    expect(firstPage.map((block) => block.id)).toEqual([
      targets[4].id,
      targets[3].id
    ])
    expect(secondPage.map((block) => block.id)).toEqual([targets[0].id])
    expect(newerPage.map((block) => block.id)).toEqual([
      targets[2].id,
      targets[1].id
    ])
    expect(sincePage.map((block) => block.id)).toEqual([
      targets[4].id,
      targets[3].id
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

  it('returns empty pages for unknown block cursors', async () => {
    const actorId = `https://remote.test/users/cursor-${crypto.randomUUID()}`
    await database.createBlock({
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
    ).resolves.toEqual([])
    await expect(
      database.getBlocks({
        actorId,
        limit: 2,
        minId: crypto.randomUUID()
      })
    ).resolves.toEqual([])
    await expect(
      database.getBlocks({
        actorId,
        limit: 2,
        sinceId: crypto.randomUUID()
      })
    ).resolves.toEqual([])
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

  it('returns all block relations across chunked bulk filtering inputs', async () => {
    const actorIds = Array.from(
      { length: 1005 },
      (_, index) =>
        `https://remote.test/users/chunk-actor-${index}-${crypto.randomUUID()}`
    )
    const targetActorIds = Array.from(
      { length: 1005 },
      (_, index) =>
        `https://remote.test/users/chunk-target-${index}-${crypto.randomUUID()}`
    )
    const expectedRelations = [
      {
        actorId: actorIds[204],
        targetActorId: targetActorIds[304]
      },
      {
        actorId: actorIds[1004],
        targetActorId: targetActorIds[0]
      },
      {
        actorId: targetActorIds[1001],
        targetActorId: actorIds[1002]
      }
    ]

    await Promise.all(
      expectedRelations.map(({ actorId, targetActorId }) =>
        database.createBlock({
          actorId,
          targetActorId,
          uri: `${actorId}#blocks/${crypto.randomUUID()}`
        })
      )
    )

    await expect(
      database.getBlockRelations({
        actorIds: [actorIds[204], ...actorIds, actorIds[1002], actorIds[1004]],
        targetActorIds: [
          targetActorIds[0],
          ...targetActorIds,
          targetActorIds[1001],
          targetActorIds[304]
        ]
      })
    ).resolves.toIncludeSameMembers(expectedRelations)
  })

  it('runs chunked block relation lookups concurrently', async () => {
    const actorIds = Array.from(
      { length: 1001 },
      (_, index) => `https://remote.test/users/concurrent-actor-${index}`
    )
    const targetActorIds = Array.from(
      { length: 1001 },
      (_, index) => `https://remote.test/users/concurrent-target-${index}`
    )
    let startedQueries = 0
    let releaseQueries = false
    const resolvers: Array<() => void> = []

    const releaseAllQueries = () => {
      releaseQueries = true
      while (resolvers.length > 0) {
        resolvers.pop()?.()
      }
    }

    const builder = {
      orWhere: vi.fn((callback?: (value: typeof builder) => void) => {
        callback?.(builder)
        return builder
      }),
      where: vi.fn((callback?: (value: typeof builder) => void) => {
        callback?.(builder)
        return builder
      }),
      whereIn: vi.fn(() => builder)
    }
    const databaseStub = vi.fn(() => {
      const promise = new Promise<BlockRelation[]>((resolve) => {
        const resolver = () => resolve([])
        if (releaseQueries) {
          resolver()
        } else {
          resolvers.push(resolver)
        }
      })
      const query = {
        select: vi.fn(() => query),
        then: promise.then.bind(promise),
        where: vi.fn((callback?: (value: typeof builder) => void) => {
          startedQueries += 1
          callback?.(builder)
          return query
        })
      }

      return query
    }) as unknown as Knex
    const blockDatabase = BlockSQLDatabaseMixin(databaseStub)

    const relationsPromise = blockDatabase.getBlockRelations({
      actorIds,
      targetActorIds
    })

    await Promise.resolve()

    try {
      expect(startedQueries).toBe(4)
    } finally {
      releaseAllQueries()
    }
    await expect(relationsPromise).resolves.toEqual([])
  })
})

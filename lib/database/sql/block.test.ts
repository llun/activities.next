import crypto from 'crypto'
import type { Knex } from 'knex'

import { CounterKey, getCounterValue } from '@/lib/database/sql/utils/counter'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

describe('BlockDatabase', () => {
  const testDb = createTestDatabase()
  const knexDatabase: Knex = testDb.knex
  const database: Database = testDb.database

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await testDb.destroy()
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

  it('returns the existing block when another pair already owns the uri', async () => {
    const owner = `https://remote.test/users/uri-owner-${crypto.randomUUID()}`
    const other = `https://remote.test/users/uri-other-${crypto.randomUUID()}`
    const target = targetActorId()
    const otherTarget = targetActorId()
    const uri = `${owner}#blocks/${crypto.randomUUID()}`
    const first = await database.createBlock({
      actorId: owner,
      targetActorId: target,
      uri
    })

    await expect(
      database.createBlock({
        actorId: other,
        targetActorId: otherTarget,
        uri
      })
    ).resolves.toEqual(first)

    // The insert that hit the unique uri failed before touching the counters.
    await expect(
      database.getBlock({ actorId: other, targetActorId: otherTarget })
    ).resolves.toBeNull()
    expect(
      await getCounterValue(knexDatabase, CounterKey.totalBlocking(other))
    ).toBe(0)
    expect(
      await getCounterValue(
        knexDatabase,
        CounterKey.totalBlockedBy(otherTarget)
      )
    ).toBe(0)
    expect(
      await getCounterValue(knexDatabase, CounterKey.totalBlocking(owner))
    ).toBe(1)
  })

  it('looks blocks up by the exact actor and target pair', async () => {
    const actorId = `https://remote.test/users/pair-${crypto.randomUUID()}`
    const otherActorId = `https://remote.test/users/pair-${crypto.randomUUID()}`
    const target = targetActorId()
    const otherTarget = targetActorId()
    const uri = `${actorId}#blocks/${crypto.randomUUID()}`
    // The neighbours go first, so a lookup missing one of its predicates
    // finds them before it finds the pair.
    await database.createBlock({
      actorId: otherActorId,
      targetActorId: target,
      uri: `${otherActorId}#blocks/${crypto.randomUUID()}`
    })
    await database.createBlock({
      actorId,
      targetActorId: otherTarget,
      uri: `${actorId}#blocks/${crypto.randomUUID()}`
    })
    const block = await database.createBlock({
      actorId,
      targetActorId: target,
      uri
    })

    await expect(
      database.getBlock({ actorId, targetActorId: target })
    ).resolves.toEqual(block)
    await expect(database.getBlockByUri({ uri })).resolves.toEqual(block)
    // Neither the actor alone, nor the target alone, nor the reverse pair.
    await expect(
      database.getBlock({ actorId: otherActorId, targetActorId: otherTarget })
    ).resolves.toBeNull()
    await expect(
      database.getBlock({ actorId: target, targetActorId: actorId })
    ).resolves.toBeNull()

    expect(await database.isBlocking({ actorId, targetActorId: target })).toBe(
      true
    )
    expect(
      await database.isBlocking({
        actorId: otherActorId,
        targetActorId: otherTarget
      })
    ).toBe(false)
    expect(
      await database.isBlocking({ actorId: target, targetActorId: actorId })
    ).toBe(false)
  })

  it('reports a block in either direction only for the exact pair', async () => {
    const actorId = `https://remote.test/users/either-${crypto.randomUUID()}`
    const target = targetActorId()
    const stranger = targetActorId()
    const otherBlocker = targetActorId()
    await database.createBlock({
      actorId: otherBlocker,
      targetActorId: stranger,
      uri: `${otherBlocker}#blocks/${crypto.randomUUID()}`
    })
    await database.createBlock({
      actorId,
      targetActorId: target,
      uri: `${actorId}#blocks/${crypto.randomUUID()}`
    })

    expect(
      await database.isEitherBlocking({ actorIdA: actorId, actorIdB: target })
    ).toBe(true)
    expect(
      await database.isEitherBlocking({ actorIdA: target, actorIdB: actorId })
    ).toBe(true)
    // Each of the pair is blocked by or blocking somebody else, not the other.
    expect(
      await database.isEitherBlocking({
        actorIdA: actorId,
        actorIdB: stranger
      })
    ).toBe(false)
    expect(
      await database.isEitherBlocking({
        actorIdA: stranger,
        actorIdB: actorId
      })
    ).toBe(false)
    expect(
      await database.isEitherBlocking({
        actorIdA: target,
        actorIdB: otherBlocker
      })
    ).toBe(false)
    expect(
      await database.isEitherBlocking({
        actorIdA: otherBlocker,
        actorIdB: target
      })
    ).toBe(false)
  })

  it('deletes exactly the named block and decrements its counters', async () => {
    const actorId = `https://remote.test/users/delete-${crypto.randomUUID()}`
    const otherActorId = `https://remote.test/users/delete-${crypto.randomUUID()}`
    const target = targetActorId()
    const otherTarget = targetActorId()
    const create = (blocker: string, blocked: string) =>
      database.createBlock({
        actorId: blocker,
        targetActorId: blocked,
        uri: `${blocker}#blocks/${crypto.randomUUID()}`
      })
    // Neighbours first: one shares the target, one shares the actor.
    const sameTarget = await create(otherActorId, target)
    const sameActor = await create(actorId, otherTarget)
    const block = await create(actorId, target)
    const counter = (key: string) => getCounterValue(knexDatabase, key)
    expect(await counter(CounterKey.totalBlocking(actorId))).toBe(2)
    expect(await counter(CounterKey.totalBlockedBy(target))).toBe(2)

    await expect(
      database.deleteBlock({ actorId, targetActorId: target })
    ).resolves.toEqual(block)

    await expect(
      database.getBlock({ actorId, targetActorId: target })
    ).resolves.toBeNull()
    await expect(
      database.getBlock({ actorId, targetActorId: otherTarget })
    ).resolves.toEqual(sameActor)
    await expect(
      database.getBlock({ actorId: otherActorId, targetActorId: target })
    ).resolves.toEqual(sameTarget)
    expect(await counter(CounterKey.totalBlocking(actorId))).toBe(1)
    expect(await counter(CounterKey.totalBlockedBy(target))).toBe(1)
    expect(await counter(CounterKey.totalBlocking(otherActorId))).toBe(1)
    expect(await counter(CounterKey.totalBlockedBy(otherTarget))).toBe(1)

    // Nothing left to delete: no row, no counter movement.
    await expect(
      database.deleteBlock({ actorId, targetActorId: target })
    ).resolves.toBeNull()
    await expect(
      database.deleteBlock({
        actorId: otherActorId,
        targetActorId: otherTarget
      })
    ).resolves.toBeNull()
    expect(await counter(CounterKey.totalBlocking(actorId))).toBe(1)
    expect(await counter(CounterKey.totalBlockedBy(target))).toBe(1)
  })

  it('deletes only the block with the given uri and decrements its counters', async () => {
    const actorId = `https://remote.test/users/delete-uri-${crypto.randomUUID()}`
    const target = targetActorId()
    const otherTarget = targetActorId()
    const keptUri = `${actorId}#blocks/${crypto.randomUUID()}`
    const deletedUri = `${actorId}#blocks/${crypto.randomUUID()}`
    const kept = await database.createBlock({
      actorId,
      targetActorId: otherTarget,
      uri: keptUri
    })
    const deleted = await database.createBlock({
      actorId,
      targetActorId: target,
      uri: deletedUri
    })

    await expect(
      database.deleteBlockByUri({ actorId, uri: deletedUri })
    ).resolves.toEqual(deleted)

    await expect(
      database.getBlockByUri({ uri: deletedUri })
    ).resolves.toBeNull()
    await expect(database.getBlockByUri({ uri: keptUri })).resolves.toEqual(
      kept
    )
    expect(
      await getCounterValue(knexDatabase, CounterKey.totalBlocking(actorId))
    ).toBe(1)
    expect(
      await getCounterValue(knexDatabase, CounterKey.totalBlockedBy(target))
    ).toBe(0)
    expect(
      await getCounterValue(
        knexDatabase,
        CounterKey.totalBlockedBy(otherTarget)
      )
    ).toBe(1)
  })

  it('lists only the actor blocks and ignores another actor cursor', async () => {
    const actorId = `https://remote.test/users/list-${crypto.randomUUID()}`
    const otherActorId = `https://remote.test/users/list-${crypto.randomUUID()}`
    const mine = await database.createBlock({
      actorId,
      targetActorId: targetActorId(),
      uri: `${actorId}#blocks/${crypto.randomUUID()}`
    })
    const theirs = await database.createBlock({
      actorId: otherActorId,
      targetActorId: targetActorId(),
      uri: `${otherActorId}#blocks/${crypto.randomUUID()}`
    })
    // The foreign cursor is strictly newer, so a lookup that found it would
    // page to `mine` instead of returning nothing (two blocks written in the
    // same millisecond would leave that to the order of their random ids).
    await knexDatabase('blocks')
      .where({ id: theirs.id })
      .update({ createdAt: new Date(mine.createdAt + 60_000) })

    await expect(database.getBlocks({ actorId, limit: 10 })).resolves.toEqual([
      mine
    ])
    await expect(
      database.getBlocks({ actorId, limit: 10, maxId: theirs.id })
    ).resolves.toEqual([])
    await expect(
      database.getBlocks({ actorId: otherActorId, limit: 10 })
    ).resolves.toMatchObject([{ id: theirs.id }])
  })

  it('returns only relations between the requested actors and targets', async () => {
    const actorId = `https://remote.test/users/scope-${crypto.randomUUID()}`
    const outsideActor = targetActorId()
    const target = targetActorId()
    const outsideTarget = targetActorId()
    const create = (blocker: string, blocked: string) =>
      database.createBlock({
        actorId: blocker,
        targetActorId: blocked,
        uri: `${blocker}#blocks/${crypto.randomUUID()}`
      })
    await Promise.all([
      create(actorId, target),
      // Right actor, target outside the request; and the reverse of both.
      create(actorId, outsideTarget),
      create(outsideTarget, actorId),
      // Right target, actor outside the request; and the reverse of both.
      create(outsideActor, target),
      create(target, outsideActor)
    ])

    await expect(
      database.getBlockRelations({
        actorIds: [actorId],
        targetActorIds: [target]
      })
    ).resolves.toEqual([{ actorId, targetActorId: target }])
    await expect(
      database.getBlockRelations({
        actorIds: [target],
        targetActorIds: [actorId]
      })
    ).resolves.toEqual([{ actorId, targetActorId: target }])
  })
})

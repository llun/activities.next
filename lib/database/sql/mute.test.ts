import crypto from 'crypto'
import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

describe('MuteDatabase', () => {
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
    `https://remote.test/users/muted-${crypto.randomUUID()}`

  it('creates a mute and returns it', async () => {
    const target = targetActorId()

    const mute = await database.createMute({
      actorId: ACTOR1_ID,
      targetActorId: target,
      notifications: true,
      endsAt: null
    })

    expect(mute.actorId).toBe(ACTOR1_ID)
    expect(mute.targetActorId).toBe(target)
    expect(mute.notifications).toBe(true)
    expect(mute.endsAt).toBeNull()
    expect(
      await database.isMuting({ actorId: ACTOR1_ID, targetActorId: target })
    ).toBe(true)
  })

  it('updates notifications and endsAt when re-muting the same target', async () => {
    const target = targetActorId()
    const endsAt = Date.now() + 60_000

    await database.createMute({
      actorId: ACTOR1_ID,
      targetActorId: target,
      notifications: true,
      endsAt: null
    })

    const updated = await database.createMute({
      actorId: ACTOR1_ID,
      targetActorId: target,
      notifications: false,
      endsAt
    })

    expect(updated.notifications).toBe(false)
    expect(updated.endsAt).toBe(endsAt)

    const fetched = await database.getMute({
      actorId: ACTOR1_ID,
      targetActorId: target
    })
    expect(fetched?.notifications).toBe(false)
    expect(fetched?.endsAt).toBe(endsAt)
  })

  it('deletes a mute and returns the old record', async () => {
    const target = targetActorId()

    const created = await database.createMute({
      actorId: ACTOR1_ID,
      targetActorId: target,
      notifications: true,
      endsAt: null
    })

    const deleted = await database.deleteMute({
      actorId: ACTOR1_ID,
      targetActorId: target
    })

    expect(deleted?.id).toBe(created.id)
    expect(
      await database.isMuting({ actorId: ACTOR1_ID, targetActorId: target })
    ).toBe(false)
  })

  it('returns null when deleting a non-existent mute', async () => {
    const result = await database.deleteMute({
      actorId: ACTOR1_ID,
      targetActorId: targetActorId()
    })

    expect(result).toBeNull()
  })

  it('returns false from isMuting when no mute exists', async () => {
    const result = await database.isMuting({
      actorId: ACTOR1_ID,
      targetActorId: targetActorId()
    })

    expect(result).toBe(false)
  })

  it('getMute returns null when no mute exists', async () => {
    const result = await database.getMute({
      actorId: ACTOR1_ID,
      targetActorId: targetActorId()
    })

    expect(result).toBeNull()
  })

  it('getMuteRelations returns only forward directional relations', async () => {
    const actorId = `https://remote.test/users/muter-${crypto.randomUUID()}`
    const mutedTarget = targetActorId()
    const unrelatedTarget = targetActorId()
    const reverseMuter = targetActorId()

    await database.createMute({
      actorId,
      targetActorId: mutedTarget,
      notifications: true,
      endsAt: null
    })
    await database.createMute({
      actorId: reverseMuter,
      targetActorId: actorId,
      notifications: false,
      endsAt: null
    })

    const relations = await database.getMuteRelations({
      actorIds: [actorId],
      targetActorIds: [mutedTarget, unrelatedTarget]
    })

    expect(relations).toHaveLength(1)
    expect(relations[0]).toMatchObject({
      actorId,
      targetActorId: mutedTarget,
      notifications: true
    })
  })

  it('getMuteRelations returns empty array for empty inputs', async () => {
    await expect(
      database.getMuteRelations({ actorIds: [], targetActorIds: [] })
    ).resolves.toEqual([])

    await expect(
      database.getMuteRelations({
        actorIds: [ACTOR1_ID],
        targetActorIds: []
      })
    ).resolves.toEqual([])

    await expect(
      database.getMuteRelations({
        actorIds: [],
        targetActorIds: [targetActorId()]
      })
    ).resolves.toEqual([])
  })

  it('re-muting an expired mute updates the row instead of throwing (unique constraint)', async () => {
    const target = targetActorId()
    const pastEndsAt = Date.now() - 1000

    // Insert an expired mute directly (bypassing createMute so endsAt is in the past)
    await knexDatabase('mutes').insert({
      id: crypto.randomUUID(),
      actorId: ACTOR1_ID,
      actorHost: new URL(ACTOR1_ID).host,
      targetActorId: target,
      targetActorHost: new URL(target).host,
      notifications: true,
      endsAt: pastEndsAt,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    // Re-muting should succeed (UPDATE, not INSERT) and return fresh params
    const remute = await database.createMute({
      actorId: ACTOR1_ID,
      targetActorId: target,
      notifications: false,
      endsAt: null
    })

    expect(remute.notifications).toBe(false)
    expect(remute.endsAt).toBeNull()
    // Only one row should exist
    const count = await knexDatabase('mutes')
      .where({ actorId: ACTOR1_ID, targetActorId: target })
      .count('id as n')
      .first()
    expect(Number(count?.n)).toBe(1)
    // And getMute now sees it as active
    await expect(
      database.getMute({ actorId: ACTOR1_ID, targetActorId: target })
    ).resolves.not.toBeNull()
  })

  it('getMute returns null for an expired mute', async () => {
    const target = targetActorId()
    const pastEndsAt = Date.now() - 1000

    await knexDatabase('mutes').insert({
      id: crypto.randomUUID(),
      actorId: ACTOR1_ID,
      actorHost: new URL(ACTOR1_ID).host,
      targetActorId: target,
      targetActorHost: new URL(target).host,
      notifications: true,
      endsAt: pastEndsAt,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    await expect(
      database.getMute({ actorId: ACTOR1_ID, targetActorId: target })
    ).resolves.toBeNull()
  })

  it('isMuting returns false for an expired mute', async () => {
    const target = targetActorId()
    const pastEndsAt = Date.now() - 1000

    await knexDatabase('mutes').insert({
      id: crypto.randomUUID(),
      actorId: ACTOR1_ID,
      actorHost: new URL(ACTOR1_ID).host,
      targetActorId: target,
      targetActorHost: new URL(target).host,
      notifications: true,
      endsAt: pastEndsAt,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    await expect(
      database.isMuting({ actorId: ACTOR1_ID, targetActorId: target })
    ).resolves.toBe(false)
  })

  describe('getMutes', () => {
    const muteActorId = () =>
      `https://remote.test/users/list-muter-${crypto.randomUUID()}`

    it('returns mutes for the actor ordered by newest first', async () => {
      const actorId = muteActorId()
      const bob = targetActorId()
      const carol = targetActorId()

      await database.createMute({
        actorId,
        targetActorId: bob,
        notifications: true,
        endsAt: null
      })
      // Ensure deterministic createdAt ordering even on fast clocks.
      await new Promise((resolve) => setTimeout(resolve, 5))
      await database.createMute({
        actorId,
        targetActorId: carol,
        notifications: false,
        endsAt: null
      })

      const mutes = await database.getMutes({ actorId })
      expect(mutes).toHaveLength(2)
      expect(mutes[0].targetActorId).toBe(carol)
      expect(mutes[1].targetActorId).toBe(bob)
    })

    it('omits expired mutes', async () => {
      const actorId = muteActorId()
      const target = targetActorId()
      await knexDatabase('mutes').insert({
        id: crypto.randomUUID(),
        actorId,
        actorHost: new URL(actorId).host,
        targetActorId: target,
        targetActorHost: new URL(target).host,
        notifications: true,
        endsAt: Date.now() - 1000,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      const mutes = await database.getMutes({ actorId })
      expect(mutes).toHaveLength(0)
    })

    it('honors limit and max_id pagination', async () => {
      const actorId = muteActorId()
      const targets: string[] = []
      for (let index = 0; index < 3; index += 1) {
        const target = targetActorId()
        targets.push(target)
        await database.createMute({
          actorId,
          targetActorId: target,
          notifications: true,
          endsAt: null
        })
        await new Promise((resolve) => setTimeout(resolve, 5))
      }

      const firstPage = await database.getMutes({ actorId, limit: 2 })
      expect(firstPage).toHaveLength(2)

      const secondPage = await database.getMutes({
        actorId,
        limit: 2,
        maxId: firstPage[firstPage.length - 1].id
      })
      expect(secondPage).toHaveLength(1)
      expect(secondPage[0].id).not.toBe(firstPage[1].id)
      // Newest first means oldest mute is on the second page.
      expect(secondPage[0].targetActorId).toBe(targets[0])
    })

    it('returns earlier rows ascending when min_id is set', async () => {
      const actorId = muteActorId()
      const targets: string[] = []
      for (let index = 0; index < 3; index += 1) {
        const target = targetActorId()
        targets.push(target)
        await database.createMute({
          actorId,
          targetActorId: target,
          notifications: true,
          endsAt: null
        })
        await new Promise((resolve) => setTimeout(resolve, 5))
      }

      const allDescending = await database.getMutes({ actorId })
      // allDescending order: [targets[2], targets[1], targets[0]]
      const oldest = allDescending[allDescending.length - 1]
      const newerPage = await database.getMutes({
        actorId,
        minId: oldest.id
      })
      expect(newerPage).toHaveLength(2)
      // min_id returns rows newer than cursor, newest first to match other pages.
      expect(newerPage.map((mute) => mute.targetActorId)).toEqual([
        targets[2],
        targets[1]
      ])
    })

    it('filters out other actors mutes', async () => {
      const actorA = muteActorId()
      const actorB = muteActorId()
      await database.createMute({
        actorId: actorA,
        targetActorId: targetActorId(),
        notifications: true,
        endsAt: null
      })
      await database.createMute({
        actorId: actorB,
        targetActorId: targetActorId(),
        notifications: true,
        endsAt: null
      })

      const mutes = await database.getMutes({ actorId: actorA })
      expect(mutes).toHaveLength(1)
      expect(mutes[0].actorId).toBe(actorA)
    })
  })

  it('getMuteRelations excludes expired mutes', async () => {
    const actorId = `https://remote.test/users/expiry-${crypto.randomUUID()}`
    const expiredTarget = targetActorId()
    const activeTarget = targetActorId()
    const pastEndsAt = Date.now() - 1000
    const futureEndsAt = Date.now() + 60_000

    await knexDatabase('mutes').insert([
      {
        id: crypto.randomUUID(),
        actorId,
        actorHost: new URL(actorId).host,
        targetActorId: expiredTarget,
        targetActorHost: new URL(expiredTarget).host,
        notifications: true,
        endsAt: pastEndsAt,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: crypto.randomUUID(),
        actorId,
        actorHost: new URL(actorId).host,
        targetActorId: activeTarget,
        targetActorHost: new URL(activeTarget).host,
        notifications: false,
        endsAt: futureEndsAt,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ])

    const relations = await database.getMuteRelations({
      actorIds: [actorId],
      targetActorIds: [expiredTarget, activeTarget]
    })

    expect(relations).toHaveLength(1)
    expect(relations[0]).toMatchObject({
      actorId,
      targetActorId: activeTarget,
      notifications: false
    })
  })
})

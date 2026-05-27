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
    expect(await database.isMuting({ actorId: ACTOR1_ID, targetActorId: target })).toBe(true)
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

    const fetched = await database.getMute({ actorId: ACTOR1_ID, targetActorId: target })
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
    expect(await database.isMuting({ actorId: ACTOR1_ID, targetActorId: target })).toBe(false)
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
    const count = await knexDatabase('mutes').where({ actorId: ACTOR1_ID, targetActorId: target }).count('id as n').first()
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

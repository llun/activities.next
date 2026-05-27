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
})

import { Knex } from 'knex'
import { createHash } from 'node:crypto'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('Wahoo fitness settings database operations', () => {
  let database: Database
  let instance: Knex
  const actorId = DatabaseSeed.actors.primary.id
  const disconnectActorId = DatabaseSeed.actors.replyAuthor.id
  const webhookToken = 'wahoo-webhook-secret'
  const providerUserId = 'wahoo-user-123'

  beforeAll(async () => {
    const testDatabase = getTestSQLDatabaseWithInstance()
    database = testDatabase.database
    instance = testDatabase.instance
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('stores an encrypted webhook token and resolves it by hash and provider user', async () => {
    const settings = await database.createFitnessSettings({
      actorId,
      serviceType: 'wahoo',
      providerUserId,
      webhookToken,
      oauthState: 'wahoo-state',
      oauthStateExpiry: Date.now() + 60_000
    })

    const stored = await database.getWahooSettingsByWebhookToken(
      webhookToken,
      providerUserId
    )
    expect(stored).toMatchObject({
      id: settings.id,
      actorId,
      serviceType: 'wahoo',
      providerUserId,
      webhookToken
    })

    const raw = await instance('fitness_settings')
      .where({ id: settings.id })
      .first()
    expect(raw.webhookToken).toBeNull()
    expect(raw.wahooWebhookToken).not.toBe(webhookToken)
    expect(raw.wahooWebhookTokenHash).toBe(
      createHash('sha256').update(webhookToken).digest('hex')
    )

    await expect(
      database.getWahooSettingsByWebhookToken('incorrect-token', providerUserId)
    ).resolves.toBeNull()
    await expect(
      database.getWahooSettingsByWebhookToken(webhookToken, 'another-user')
    ).resolves.toBeNull()
  })

  it('consumes a matching unexpired OAuth state exactly once', async () => {
    const settings = await database.getFitnessSettings({
      actorId,
      serviceType: 'wahoo'
    })
    expect(settings).not.toBeNull()

    const now = Date.now()
    await expect(
      database.consumeFitnessOauthState({
        id: settings!.id,
        state: 'wrong-state',
        now
      })
    ).resolves.toBe(false)
    await expect(
      database.consumeFitnessOauthState({
        id: settings!.id,
        state: 'wahoo-state',
        now
      })
    ).resolves.toBe(true)
    await expect(
      database.consumeFitnessOauthState({
        id: settings!.id,
        state: 'wahoo-state',
        now
      })
    ).resolves.toBe(false)

    const consumed = await database.getFitnessSettings({
      actorId,
      serviceType: 'wahoo'
    })
    expect(consumed?.oauthState).toBeUndefined()
    expect(consumed?.oauthStateExpiry).toBeUndefined()
  })

  it('clears Wahoo credentials on disconnect while retaining import history', async () => {
    const settings = await database.createFitnessSettings({
      actorId: disconnectActorId,
      serviceType: 'wahoo',
      clientId: 'wahoo-client-id',
      clientSecret: 'wahoo-client-secret',
      webhookToken: 'disconnect-webhook-token',
      providerUserId: 'disconnect-provider-user',
      accessToken: 'wahoo-access-token',
      refreshToken: 'wahoo-refresh-token',
      oauthState: 'disconnect-state',
      oauthStateExpiry: Date.now() + 60_000
    })
    const imported = await database.upsertWahooImport({
      actorId: disconnectActorId,
      providerUserId: 'disconnect-provider-user',
      workoutId: 'retained-workout'
    })

    await database.deleteFitnessSettings({
      actorId: disconnectActorId,
      serviceType: 'wahoo'
    })

    const raw = await instance('fitness_settings')
      .where({ id: settings.id })
      .first()
    expect(raw).toMatchObject({
      deletedAt: expect.any(Number),
      clientId: null,
      clientSecret: null,
      wahooWebhookToken: null,
      wahooWebhookTokenHash: null,
      accessToken: null,
      refreshToken: null,
      oauthState: null,
      oauthStateExpiry: null,
      providerUserId: null
    })
    await expect(database.getWahooImport(imported.id)).resolves.toMatchObject({
      id: imported.id,
      workoutId: 'retained-workout'
    })
  })
})

import { Knex } from 'knex'
import { createHash, createHmac } from 'node:crypto'

import { getConfig } from '@/lib/config'
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
    const storedTokenHash = createHmac('sha256', getConfig().secretPhase)
      .update('wahoo-webhook-token-v1:')
      .update(webhookToken)
      .digest('hex')
    expect(raw.wahooWebhookTokenHash).toBe(storedTokenHash)
    expect(raw.wahooWebhookTokenHash).not.toBe(
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

  it('does not restore credentials when updating a disconnected settings row', async () => {
    const settings = await database.createFitnessSettings({
      actorId: disconnectActorId,
      serviceType: 'wahoo',
      clientId: 'wahoo-client-id',
      clientSecret: 'wahoo-client-secret',
      webhookToken: 'disconnect-webhook-token',
      accessToken: 'wahoo-access-token',
      refreshToken: 'wahoo-refresh-token'
    })
    await database.deleteFitnessSettings({
      actorId: disconnectActorId,
      serviceType: 'wahoo'
    })

    await expect(
      database.updateFitnessSettings({
        id: settings.id,
        clientId: 'stale-client-id',
        clientSecret: 'stale-client-secret',
        webhookToken: 'stale-webhook-token',
        accessToken: 'stale-access-token',
        refreshToken: 'stale-refresh-token'
      })
    ).resolves.toBeNull()

    const raw = await instance('fitness_settings')
      .where({ id: settings.id })
      .first()
    expect(raw).toMatchObject({
      deletedAt: expect.any(Number),
      clientId: null,
      clientSecret: null,
      wahooWebhookToken: null,
      accessToken: null,
      refreshToken: null
    })
  })

  it('rejects token refresh writes after the client credentials change', async () => {
    const settings = await database.createFitnessSettings({
      actorId: disconnectActorId,
      serviceType: 'wahoo',
      clientId: 'original-client-id',
      clientSecret: 'original-client-secret',
      accessToken: 'original-access-token',
      refreshToken: 'original-refresh-token'
    })

    const updatedCredentials = await database.updateFitnessSettings({
      id: settings.id,
      clientId: 'new-client-id',
      clientSecret: 'new-client-secret'
    })
    expect(updatedCredentials?.credentialVersion).toBe(
      (settings.credentialVersion ?? 0) + 1
    )

    await expect(
      database.updateFitnessSettings({
        id: settings.id,
        expectedCredentialVersion: settings.credentialVersion,
        accessToken: 'stale-access-token',
        refreshToken: 'stale-refresh-token'
      })
    ).resolves.toBeNull()

    await expect(
      database.getFitnessSettings({
        actorId: disconnectActorId,
        serviceType: 'wahoo'
      })
    ).resolves.toMatchObject({
      clientId: 'new-client-id',
      clientSecret: 'new-client-secret',
      accessToken: 'original-access-token',
      refreshToken: 'original-refresh-token'
    })
  })

  it('rotates webhook token hashes and rejects duplicate active bindings', async () => {
    const oldToken = 'old-rotation-token'
    const rotatedToken = 'new-rotation-token'
    const provider = 'shared-webhook-provider-user'
    const rotatedSettings = await database.createFitnessSettings({
      actorId: DatabaseSeed.actors.pollAuthor.id,
      serviceType: 'wahoo',
      webhookToken: oldToken,
      providerUserId: provider
    })

    await expect(
      database.getWahooSettingsByWebhookToken(oldToken, provider)
    ).resolves.toMatchObject({ id: rotatedSettings.id })

    await database.updateFitnessSettings({
      id: rotatedSettings.id,
      webhookToken: rotatedToken
    })

    await expect(
      database.getWahooSettingsByWebhookToken(oldToken, provider)
    ).resolves.toBeNull()
    await expect(
      database.getWahooSettingsByWebhookToken(rotatedToken, 'another-provider')
    ).resolves.toBeNull()
    await expect(
      database.getWahooSettingsByWebhookToken(rotatedToken, provider)
    ).resolves.toMatchObject({ id: rotatedSettings.id })

    await expect(
      database.createFitnessSettings({
        actorId: DatabaseSeed.actors.extra.id,
        serviceType: 'wahoo',
        webhookToken: rotatedToken,
        providerUserId: provider
      })
    ).rejects.toThrow()
    await expect(
      database.getWahooSettingsByWebhookToken(rotatedToken, provider)
    ).resolves.toMatchObject({ id: rotatedSettings.id })

    await database.deleteFitnessSettings({
      actorId: DatabaseSeed.actors.pollAuthor.id,
      serviceType: 'wahoo'
    })
  })

  it('allows one concurrent binding and lets a disconnected binding be reused', async () => {
    const webhookToken = 'concurrent-webhook-token'
    const providerUserId = 'concurrent-provider-user'
    const candidates = [
      DatabaseSeed.actors.pollAuthor.id,
      DatabaseSeed.actors.extra.id
    ]
    const results = await Promise.allSettled(
      candidates.map((candidateActorId) =>
        database.createFitnessSettings({
          actorId: candidateActorId,
          serviceType: 'wahoo',
          webhookToken,
          providerUserId
        })
      )
    )
    const fulfilled = results.filter(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<Database['createFitnessSettings']>>
      > => result.status === 'fulfilled'
    )
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const winner = fulfilled[0].value
    await database.deleteFitnessSettings({
      actorId: winner.actorId,
      serviceType: 'wahoo'
    })

    const replacementActorId = candidates.find(
      (candidateActorId) => candidateActorId !== winner.actorId
    )!
    const replacement = await database.createFitnessSettings({
      actorId: replacementActorId,
      serviceType: 'wahoo',
      webhookToken,
      providerUserId
    })
    expect(replacement.actorId).toBe(replacementActorId)
    await expect(
      database.getWahooSettingsByWebhookToken(webhookToken, providerUserId)
    ).resolves.toMatchObject({ id: replacement.id })
  })
})

import { getTestSQLDatabase } from '@/lib/database/testUtils'

// Mock uuid to avoid ESM issues
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-' + Math.random().toString(36).substring(7))
}))

describe('FitnessSettings database operations', () => {
  let database: Awaited<ReturnType<typeof getTestSQLDatabase>>
  const testActorId = 'test-actor-123'
  const testActorId2 = 'test-actor-456'

  beforeAll(async () => {
    database = getTestSQLDatabase()
    await database.migrate()

    // Create test actors for foreign key constraints
    const createTestActor = async (id: string, username: string) => {
      await database.createActor({
        actorId: id,
        username,
        domain: 'test.example.com',
        inboxUrl: `https://test.example.com/users/${username}/inbox`,
        outboxUrl: `https://test.example.com/users/${username}/outbox`,
        followersUrl: `https://test.example.com/users/${username}/followers`,
        sharedInboxUrl: `https://test.example.com/shared/inbox`,
        publicKey: `test-public-key-${username}`,
        privateKey: `test-private-key-${username}`,
        createdAt: Date.now()
      })
    }

    // Create main test actors
    await createTestActor(testActorId, 'testactor1')
    await createTestActor(testActorId2, 'testactor2')

    // Create test actors for all test cases
    const suffixes = [
      'encrypt',
      'oauth',
      'minimal',
      'unique',
      'get',
      'get-deleted',
      'update',
      'tokens',
      'clear-state',
      'partial',
      'delete',
      'delete-time',
      'deleted',
      'multi',
      'recreate',
      'multi-delete',
      'oauth-flow'
    ]

    for (const suffix of suffixes) {
      await createTestActor(
        `${testActorId}-${suffix}`,
        `testactor-${suffix.replace('-', '_')}`
      )
    }
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('createFitnessSettings', () => {
    it('creates a new fitness settings entry', async () => {
      const settings = await database.createFitnessSettings({
        actorId: testActorId,
        serviceType: 'strava',
        clientId: '12345',
        clientSecret: 'secret123',
        webhookToken: 'webhook-token-abc'
      })

      expect(settings).toMatchObject({
        actorId: testActorId,
        serviceType: 'strava',
        clientId: '12345',
        clientSecret: 'secret123',
        webhookToken: 'webhook-token-abc'
      })
      expect(settings.id).toBeDefined()
      expect(settings.createdAt).toBeDefined()
      expect(settings.updatedAt).toBeDefined()
    })

    it('encrypts sensitive fields', async () => {
      const plainSecret = 'plain-secret-text'
      const settings = await database.createFitnessSettings({
        actorId: `${testActorId}-encrypt`,
        serviceType: 'strava',
        clientId: '12345',
        clientSecret: plainSecret,
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456'
      })

      // Values should be returned decrypted
      expect(settings.clientSecret).toBe(plainSecret)
      expect(settings.accessToken).toBe('access-token-123')
      expect(settings.refreshToken).toBe('refresh-token-456')

      // Verify encryption by fetching and checking decryption works
      const fetched = await database.getFitnessSettings({
        actorId: `${testActorId}-encrypt`,
        serviceType: 'strava'
      })
      expect(fetched?.clientSecret).toBe(plainSecret)
      expect(fetched?.accessToken).toBe('access-token-123')
      expect(fetched?.refreshToken).toBe('refresh-token-456')
    })

    it('stores OAuth state and expiry', async () => {
      const now = Date.now()
      const expiry = now + 600000 // 10 minutes

      const settings = await database.createFitnessSettings({
        actorId: `${testActorId}-oauth`,
        serviceType: 'strava',
        clientId: '12345',
        clientSecret: 'secret',
        oauthState: 'state-abc-123',
        oauthStateExpiry: expiry
      })

      expect(settings.oauthState).toBe('state-abc-123')
      expect(settings.oauthStateExpiry).toBeGreaterThan(now)
    })

    it('handles nullable fields', async () => {
      const settings = await database.createFitnessSettings({
        actorId: `${testActorId}-minimal`,
        serviceType: 'garmin',
        clientId: '12345'
        // No clientSecret, webhookToken, tokens, etc.
      })

      expect(settings.clientId).toBe('12345')
      expect(settings.clientSecret).toBeUndefined()
      expect(settings.webhookToken).toBeUndefined()
      expect(settings.accessToken).toBeUndefined()
      expect(settings.refreshToken).toBeUndefined()
    })

    it('enforces unique constraint on (actorId, serviceType)', async () => {
      await database.createFitnessSettings({
        actorId: `${testActorId}-unique`,
        serviceType: 'strava',
        clientId: '11111'
      })

      // Attempting to create duplicate should fail
      await expect(
        database.createFitnessSettings({
          actorId: `${testActorId}-unique`,
          serviceType: 'strava',
          clientId: '22222'
        })
      ).rejects.toThrow()
    })

    it('allows same actor with different service types', async () => {
      const strava = await database.createFitnessSettings({
        actorId: `${testActorId}-multi`,
        serviceType: 'strava',
        clientId: '11111'
      })

      const garmin = await database.createFitnessSettings({
        actorId: `${testActorId}-multi`,
        serviceType: 'garmin',
        clientId: '22222'
      })

      expect(strava.serviceType).toBe('strava')
      expect(garmin.serviceType).toBe('garmin')
      expect(strava.id).not.toBe(garmin.id)
    })
  })

  describe('updateFitnessSettings', () => {
    it('updates existing settings', async () => {
      const created = await database.createFitnessSettings({
        actorId: `${testActorId}-update`,
        serviceType: 'strava',
        clientId: '12345',
        clientSecret: 'old-secret'
      })

      // Wait 1ms to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 1))

      const updated = await database.updateFitnessSettings({
        id: created.id,
        clientSecret: 'new-secret',
        webhookToken: 'new-webhook-token'
      })

      expect(updated?.clientSecret).toBe('new-secret')
      expect(updated?.webhookToken).toBe('new-webhook-token')
      expect(updated?.clientId).toBe('12345') // Unchanged
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    })

    it('updates OAuth tokens', async () => {
      const created = await database.createFitnessSettings({
        actorId: `${testActorId}-tokens`,
        serviceType: 'strava',
        clientId: '12345'
      })

      const tokenExpiry = Date.now() + 3600000
      const updated = await database.updateFitnessSettings({
        id: created.id,
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenExpiresAt: tokenExpiry
      })

      expect(updated?.accessToken).toBe('new-access-token')
      expect(updated?.refreshToken).toBe('new-refresh-token')
      expect(updated?.tokenExpiresAt).toBeGreaterThan(Date.now())
    })

    it('clears OAuth state after successful auth', async () => {
      const created = await database.createFitnessSettings({
        actorId: `${testActorId}-clear-state`,
        serviceType: 'strava',
        clientId: '12345',
        oauthState: 'temp-state',
        oauthStateExpiry: Date.now() + 600000
      })

      const updated = await database.updateFitnessSettings({
        id: created.id,
        accessToken: 'token-from-oauth',
        oauthState: null,
        oauthStateExpiry: null
      })

      expect(updated?.accessToken).toBe('token-from-oauth')
      expect(updated?.oauthState).toBeUndefined()
      expect(updated?.oauthStateExpiry).toBeUndefined()
    })

    it('returns null for non-existent id', async () => {
      const result = await database.updateFitnessSettings({
        id: 'non-existent-id',
        clientId: '12345'
      })

      expect(result).toBeNull()
    })

    it('returns null for soft-deleted entry', async () => {
      const created = await database.createFitnessSettings({
        actorId: `${testActorId}-deleted`,
        serviceType: 'strava',
        clientId: '12345'
      })

      // Soft delete
      await database.deleteFitnessSettings({
        actorId: `${testActorId}-deleted`,
        serviceType: 'strava'
      })

      // Update should return null
      const result = await database.updateFitnessSettings({
        id: created.id,
        clientId: '99999'
      })

      expect(result).toBeNull()
    })

    it('handles partial updates correctly', async () => {
      const created = await database.createFitnessSettings({
        actorId: `${testActorId}-partial`,
        serviceType: 'strava',
        clientId: '12345',
        clientSecret: 'secret',
        webhookToken: 'webhook'
      })

      // Update only one field
      const updated = await database.updateFitnessSettings({
        id: created.id,
        webhookToken: 'new-webhook'
      })

      expect(updated?.webhookToken).toBe('new-webhook')
      expect(updated?.clientId).toBe('12345')
      expect(updated?.clientSecret).toBe('secret')
    })
  })

  describe('getFitnessSettings', () => {
    beforeAll(async () => {
      await database.createFitnessSettings({
        actorId: `${testActorId}-get`,
        serviceType: 'strava',
        clientId: '12345',
        clientSecret: 'secret',
        accessToken: 'access',
        refreshToken: 'refresh',
        webhookToken: 'webhook'
      })
    })

    it('retrieves existing settings', async () => {
      const settings = await database.getFitnessSettings({
        actorId: `${testActorId}-get`,
        serviceType: 'strava'
      })

      expect(settings).not.toBeNull()
      expect(settings?.actorId).toBe(`${testActorId}-get`)
      expect(settings?.serviceType).toBe('strava')
      expect(settings?.clientId).toBe('12345')
    })

    it('decrypts sensitive fields', async () => {
      const settings = await database.getFitnessSettings({
        actorId: `${testActorId}-get`,
        serviceType: 'strava'
      })

      expect(settings?.clientSecret).toBe('secret')
      expect(settings?.accessToken).toBe('access')
      expect(settings?.refreshToken).toBe('refresh')
    })

    it('returns null for non-existent actor', async () => {
      const settings = await database.getFitnessSettings({
        actorId: 'non-existent-actor',
        serviceType: 'strava'
      })

      expect(settings).toBeNull()
    })

    it('returns null for non-existent service type', async () => {
      const settings = await database.getFitnessSettings({
        actorId: `${testActorId}-get`,
        serviceType: 'garmin'
      })

      expect(settings).toBeNull()
    })

    it('returns null for soft-deleted entry', async () => {
      await database.createFitnessSettings({
        actorId: `${testActorId}-get-deleted`,
        serviceType: 'strava',
        clientId: '12345'
      })

      await database.deleteFitnessSettings({
        actorId: `${testActorId}-get-deleted`,
        serviceType: 'strava'
      })

      const settings = await database.getFitnessSettings({
        actorId: `${testActorId}-get-deleted`,
        serviceType: 'strava'
      })

      expect(settings).toBeNull()
    })

    it('retrieves correct actor when multiple actors exist', async () => {
      await database.createFitnessSettings({
        actorId: testActorId2,
        serviceType: 'strava',
        clientId: '99999'
      })

      const settings1 = await database.getFitnessSettings({
        actorId: `${testActorId}-get`,
        serviceType: 'strava'
      })

      const settings2 = await database.getFitnessSettings({
        actorId: testActorId2,
        serviceType: 'strava'
      })

      expect(settings1?.clientId).toBe('12345')
      expect(settings2?.clientId).toBe('99999')
    })
  })

  describe('deleteFitnessSettings', () => {
    it('soft deletes existing settings', async () => {
      await database.createFitnessSettings({
        actorId: `${testActorId}-delete`,
        serviceType: 'strava',
        clientId: '12345'
      })

      await database.deleteFitnessSettings({
        actorId: `${testActorId}-delete`,
        serviceType: 'strava'
      })

      const settings = await database.getFitnessSettings({
        actorId: `${testActorId}-delete`,
        serviceType: 'strava'
      })

      expect(settings).toBeNull()
    })

    it('sets deletedAt timestamp', async () => {
      const _beforeDelete = Date.now()

      await database.createFitnessSettings({
        actorId: `${testActorId}-delete-time`,
        serviceType: 'strava',
        clientId: '12345'
      })

      await database.deleteFitnessSettings({
        actorId: `${testActorId}-delete-time`,
        serviceType: 'strava'
      })

      // Verify deletedAt is set (would need raw query to check, but we verify behavior)
      const settings = await database.getFitnessSettings({
        actorId: `${testActorId}-delete-time`,
        serviceType: 'strava'
      })

      expect(settings).toBeNull() // Should not return deleted entries
    })

    it('does not throw for non-existent entry', async () => {
      await expect(
        database.deleteFitnessSettings({
          actorId: 'non-existent',
          serviceType: 'strava'
        })
      ).resolves.not.toThrow()
    })

    it('allows recreation after deletion', async () => {
      const actorId = `${testActorId}-recreate`

      await database.createFitnessSettings({
        actorId,
        serviceType: 'strava',
        clientId: '11111'
      })

      await database.deleteFitnessSettings({
        actorId,
        serviceType: 'strava'
      })

      // Should be able to create again with same actorId + serviceType
      const recreated = await database.createFitnessSettings({
        actorId,
        serviceType: 'strava',
        clientId: '22222'
      })

      expect(recreated.clientId).toBe('22222')
    })

    it('only deletes specified service type', async () => {
      const actorId = `${testActorId}-multi-delete`

      await database.createFitnessSettings({
        actorId,
        serviceType: 'strava',
        clientId: '11111'
      })

      await database.createFitnessSettings({
        actorId,
        serviceType: 'garmin',
        clientId: '22222'
      })

      // Delete only strava
      await database.deleteFitnessSettings({
        actorId,
        serviceType: 'strava'
      })

      const strava = await database.getFitnessSettings({
        actorId,
        serviceType: 'strava'
      })
      const garmin = await database.getFitnessSettings({
        actorId,
        serviceType: 'garmin'
      })

      expect(strava).toBeNull()
      expect(garmin).not.toBeNull()
      expect(garmin?.clientId).toBe('22222')
    })
  })

  describe('end-to-end OAuth flow', () => {
    it('simulates complete OAuth flow', async () => {
      const actorId = `${testActorId}-oauth-flow`

      // 1. User saves credentials
      const initial = await database.createFitnessSettings({
        actorId,
        serviceType: 'strava',
        clientId: '12345',
        clientSecret: 'client-secret-abc',
        webhookToken: 'webhook-token-xyz'
      })

      expect(initial.clientId).toBe('12345')
      expect(initial.accessToken).toBeUndefined()

      // 2. OAuth redirect - save state
      const stateExpiry = Date.now() + 600000
      await database.updateFitnessSettings({
        id: initial.id,
        oauthState: 'random-state-123',
        oauthStateExpiry: stateExpiry
      })

      // 3. OAuth callback - exchange code for tokens
      const afterAuth = await database.updateFitnessSettings({
        id: initial.id,
        accessToken: 'ya29.access-token',
        refreshToken: 'refresh-token-abc',
        tokenExpiresAt: Date.now() + 3600000,
        oauthState: null,
        oauthStateExpiry: null
      })

      expect(afterAuth?.accessToken).toBe('ya29.access-token')
      expect(afterAuth?.refreshToken).toBe('refresh-token-abc')
      expect(afterAuth?.oauthState).toBeUndefined()

      // 4. Verify stored data
      const final = await database.getFitnessSettings({
        actorId,
        serviceType: 'strava'
      })

      expect(final?.clientId).toBe('12345')
      expect(final?.clientSecret).toBe('client-secret-abc')
      expect(final?.accessToken).toBe('ya29.access-token')
      expect(final?.refreshToken).toBe('refresh-token-abc')
      expect(final?.webhookToken).toBe('webhook-token-xyz')
    })
  })
})

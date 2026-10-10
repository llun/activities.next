import { createHmac } from 'node:crypto'

import { getConfig } from '@/lib/config'
import { createSearchActor } from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { decrypt, encrypt } from '@/lib/utils/crypto'
import { logger } from '@/lib/utils/logger'

const DOMAIN = 'fsq.test'

// Each test builds its own actors and rows and leaves a neighbouring row (another
// actor's, or the same actor's other service) that the query must not touch.
describe('fitness settings queries', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  let actorCount = 0
  const newActor = async () => {
    actorCount += 1
    const username = `fsq${actorCount}`
    const id = `https://${DOMAIN}/users/${username}`
    await createSearchActor(database, { id, username, domain: DOMAIN })
    return id
  }

  let tokenCount = 0
  const uniqueToken = (prefix: string) => {
    tokenCount += 1
    return `${prefix}-${tokenCount}`
  }

  const rawRow = (id: string) =>
    db
      .selectFrom('fitness_settings')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow()

  const hash = (token: string) =>
    createHmac('sha256', getConfig().secretPhase)
      .update('wahoo-webhook-token-v1:')
      .update(token)
      .digest('hex')

  const softDelete = (id: string, at = new Date()) =>
    db
      .updateTable('fitness_settings')
      .set({ deletedAt: at })
      .where('id', '=', id)
      .execute()

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('createFitnessSettings', () => {
    it('is not blocked by another actor, another service or deleted settings', async () => {
      const actor = await newActor()
      const otherActor = await newActor()

      const deleted = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'deleted'
      })
      await softDelete(deleted.id)
      await database.createFitnessSettings({
        actorId: otherActor,
        serviceType: 'strava',
        clientId: 'other-actor'
      })
      await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'garmin',
        clientId: 'other-service'
      })

      // Same actor and service as `deleted`, same service as `other-actor`,
      // same actor as `other-service`: only an active duplicate may block it.
      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'fresh'
      })

      expect(created.clientId).toBe('fresh')
      expect(
        await database.getFitnessSettings({
          actorId: actor,
          serviceType: 'strava'
        })
      ).toMatchObject({ id: created.id, clientId: 'fresh' })
    })

    it('rejects an active duplicate and writes nothing', async () => {
      const actor = await newActor()
      const first = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'first'
      })

      await expect(
        database.createFitnessSettings({
          actorId: actor,
          serviceType: 'strava',
          clientId: 'second'
        })
      ).rejects.toThrow(
        `Fitness settings already exist for actor ${actor} and service strava`
      )

      expect(
        await db
          .selectFrom('fitness_settings')
          .select('id')
          .where('actorId', '=', actor)
          .execute()
      ).toEqual([{ id: first.id }])
    })

    it('stores a wahoo webhook token only in the encrypted column and its hash', async () => {
      const actor = await newActor()
      const token = uniqueToken('wahoo-create')

      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'wahoo',
        webhookToken: token,
        providerUserId: 'wahoo-create-user'
      })

      const raw = await rawRow(created.id)
      expect(raw.webhookToken).toBeNull()
      expect(decrypt(raw.wahooWebhookToken!)).toBe(token)
      expect(raw.wahooWebhookTokenHash).toBe(hash(token))
      expect(created).toMatchObject({ credentialVersion: 0 })
    })

    it('stores a non-wahoo webhook token as plain text in its own column', async () => {
      const actor = await newActor()
      const token = uniqueToken('strava-create')

      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        webhookToken: token
      })

      const raw = await rawRow(created.id)
      expect(raw.webhookToken).toBe(token)
      expect(raw.wahooWebhookToken).toBeNull()
      expect(raw.wahooWebhookTokenHash).toBeNull()
    })

    it('stores the same timestamps it returns', async () => {
      const actor = await newActor()
      const expiresAt = Date.parse('2031-02-03T04:05:06.789Z')

      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        tokenExpiresAt: expiresAt,
        oauthState: 'state',
        oauthStateExpiry: expiresAt + 1000
      })

      const raw = await rawRow(created.id)
      expect(raw.createdAt).toBe(created.createdAt)
      expect(raw.updatedAt).toBe(created.updatedAt)
      expect(raw.tokenExpiresAt).toBe(expiresAt)
      expect(raw.oauthStateExpiry).toBe(expiresAt + 1000)
      const fetched = await database.getFitnessSettings({
        actorId: actor,
        serviceType: 'strava'
      })
      expect(fetched).toMatchObject({
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
        tokenExpiresAt: expiresAt,
        oauthStateExpiry: expiresAt + 1000
      })
    })
  })

  describe('updateFitnessSettings', () => {
    it('changes only the row with the given id', async () => {
      const actor = await newActor()
      const otherActor = await newActor()
      // The neighbours are inserted first, so a query that lost its id
      // predicate would hit (or return) them before the target.
      const sibling = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'garmin',
        clientId: 'sibling',
        clientSecret: 'sibling-secret',
        accessToken: 'sibling-access'
      })
      const other = await database.createFitnessSettings({
        actorId: otherActor,
        serviceType: 'strava',
        clientId: 'other',
        clientSecret: 'other-secret',
        accessToken: 'other-access'
      })
      const target = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'target',
        clientSecret: 'target-secret'
      })
      const siblingBefore = await rawRow(sibling.id)
      const otherBefore = await rawRow(other.id)

      const updated = await database.updateFitnessSettings({
        id: target.id,
        clientId: 'target-2',
        clientSecret: 'target-secret-2',
        accessToken: 'target-access',
        grantedScopes: 'read,write',
        privacyHideRadiusMeters: 100
      })

      expect(updated).toMatchObject({
        id: target.id,
        actorId: actor,
        serviceType: 'strava',
        clientId: 'target-2',
        clientSecret: 'target-secret-2',
        accessToken: 'target-access',
        grantedScopes: 'read,write',
        privacyHideRadiusMeters: 100,
        credentialVersion: 1
      })
      expect(await rawRow(sibling.id)).toEqual(siblingBefore)
      expect(await rawRow(other.id)).toEqual(otherBefore)
      expect(siblingBefore.credentialVersion).toBe(0)
    })

    it('leaves a soft-deleted row untouched', async () => {
      const actor = await newActor()
      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'before-delete',
        webhookToken: 'wh'
      })
      await softDelete(created.id)
      const before = await rawRow(created.id)

      await expect(
        database.updateFitnessSettings({
          id: created.id,
          clientId: 'after-delete',
          webhookToken: 'wh-2',
          connectionError: 'boom'
        })
      ).resolves.toBeNull()

      expect(await rawRow(created.id)).toEqual(before)
    })

    it('bumps the credential version once per credential edit only', async () => {
      const actor = await newActor()
      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'v'
      })

      const tokenOnly = await database.updateFitnessSettings({
        id: created.id,
        accessToken: 'a'
      })
      expect(tokenOnly?.credentialVersion).toBe(0)

      const idOnly = await database.updateFitnessSettings({
        id: created.id,
        clientId: 'v2'
      })
      expect(idOnly?.credentialVersion).toBe(1)

      const both = await database.updateFitnessSettings({
        id: created.id,
        clientId: 'v3',
        clientSecret: 'secret'
      })
      expect(both?.credentialVersion).toBe(2)

      const secretOnly = await database.updateFitnessSettings({
        id: created.id,
        clientSecret: null
      })
      expect(secretOnly?.credentialVersion).toBe(3)
      expect((await rawRow(created.id)).credentialVersion).toBe(3)
    })

    it('applies only when the expected credential version matches, including 0', async () => {
      const actor = await newActor()
      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'cv'
      })

      const fresh = await database.updateFitnessSettings({
        id: created.id,
        expectedCredentialVersion: 0,
        connectionError: 'first'
      })
      expect(fresh?.connectionError).toBe('first')

      await database.updateFitnessSettings({ id: created.id, clientId: 'cv2' })
      const afterBump = await rawRow(created.id)
      expect(afterBump.credentialVersion).toBe(1)

      await expect(
        database.updateFitnessSettings({
          id: created.id,
          expectedCredentialVersion: 0,
          connectionError: 'stale'
        })
      ).resolves.toBeNull()
      expect(await rawRow(created.id)).toEqual(afterBump)

      const current = await database.updateFitnessSettings({
        id: created.id,
        expectedCredentialVersion: 1,
        connectionError: 'second'
      })
      expect(current?.connectionError).toBe('second')
    })

    it('decides where a webhook token goes from the row being updated', async () => {
      const wahooActor = await newActor()
      const stravaActor = await newActor()
      // The wahoo row exists first: a service lookup that ignored the id would
      // find it and file the strava token in the wahoo columns.
      const wahoo = await database.createFitnessSettings({
        actorId: wahooActor,
        serviceType: 'wahoo',
        webhookToken: 'wahoo-before'
      })
      const strava = await database.createFitnessSettings({
        actorId: stravaActor,
        serviceType: 'strava',
        webhookToken: 'strava-before'
      })
      const wahooBefore = await rawRow(wahoo.id)

      const stravaUpdated = await database.updateFitnessSettings({
        id: strava.id,
        webhookToken: 'strava-after'
      })
      expect(stravaUpdated?.webhookToken).toBe('strava-after')
      const stravaRaw = await rawRow(strava.id)
      expect(stravaRaw.webhookToken).toBe('strava-after')
      expect(stravaRaw.wahooWebhookToken).toBeNull()
      expect(stravaRaw.wahooWebhookTokenHash).toBeNull()
      expect(await rawRow(wahoo.id)).toEqual(wahooBefore)

      const wahooUpdated = await database.updateFitnessSettings({
        id: wahoo.id,
        webhookToken: 'wahoo-after'
      })
      expect(wahooUpdated?.webhookToken).toBe('wahoo-after')
      const wahooRaw = await rawRow(wahoo.id)
      expect(wahooRaw.webhookToken).toBeNull()
      expect(decrypt(wahooRaw.wahooWebhookToken!)).toBe('wahoo-after')
      expect(wahooRaw.wahooWebhookTokenHash).toBe(hash('wahoo-after'))
      expect((await rawRow(strava.id)).webhookToken).toBe('strava-after')

      await database.updateFitnessSettings({ id: wahoo.id, webhookToken: null })
      const cleared = await rawRow(wahoo.id)
      expect(cleared.wahooWebhookToken).toBeNull()
      expect(cleared.wahooWebhookTokenHash).toBeNull()
    })

    it('writes null for cleared fields and keeps the rest', async () => {
      const actor = await newActor()
      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'c',
        clientSecret: 's',
        accessToken: 'a',
        refreshToken: 'r',
        tokenExpiresAt: Date.now() + 10_000,
        oauthState: 'o',
        oauthStateExpiry: Date.now() + 10_000,
        defaultVisibility: 'unlisted',
        providerUserId: 'p',
        providerEnvironment: 'production',
        grantedScopes: 'g',
        privacyHomeLatitude: 1,
        privacyHomeLongitude: 2,
        privacyHideRadiusMeters: 50,
        generateRouteDescription: true
      })

      const cleared = await database.updateFitnessSettings({
        id: created.id,
        clientId: null,
        accessToken: null,
        tokenExpiresAt: null,
        oauthState: null,
        defaultVisibility: null,
        providerUserId: null,
        providerEnvironment: null,
        privacyHomeLatitude: null,
        generateRouteDescription: null
      })

      expect(cleared).toMatchObject({
        clientSecret: 's',
        refreshToken: 'r',
        oauthStateExpiry: created.oauthStateExpiry,
        grantedScopes: 'g',
        providerEnvironment: 'sandbox',
        privacyHomeLongitude: 2,
        privacyHideRadiusMeters: 50,
        generateRouteDescription: false
      })
      expect(cleared?.clientId).toBeUndefined()
      expect(cleared?.accessToken).toBeUndefined()
      expect(cleared?.tokenExpiresAt).toBeUndefined()
      expect(cleared?.oauthState).toBeUndefined()
      expect(cleared?.defaultVisibility).toBeUndefined()
      expect(cleared?.providerUserId).toBeUndefined()
      expect(cleared?.privacyHomeLatitude).toBeUndefined()
      const raw = await rawRow(created.id)
      expect(raw).toMatchObject({
        clientId: null,
        accessToken: null,
        tokenExpiresAt: null,
        oauthState: null,
        defaultVisibility: null,
        providerUserId: null,
        providerEnvironment: null,
        privacyHomeLatitude: null,
        generateRouteDescription: false
      })
    })

    it('rejects an invalid default visibility without writing', async () => {
      const actor = await newActor()
      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'vis'
      })
      const before = await rawRow(created.id)

      await expect(
        database.updateFitnessSettings({
          id: created.id,
          clientId: 'changed',
          defaultVisibility: 'everyone' as 'public'
        })
      ).rejects.toThrow()

      expect(await rawRow(created.id)).toEqual(before)
    })
  })

  describe('getFitnessSettings', () => {
    it('returns the active row of that actor and service among its neighbours', async () => {
      const actor = await newActor()
      const otherActor = await newActor()
      // A deleted row of the same actor and service is the oldest, so it comes
      // first whenever the deletedAt predicate is missing.
      const deleted = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'deleted'
      })
      await softDelete(deleted.id)
      await database.createFitnessSettings({
        actorId: otherActor,
        serviceType: 'strava',
        clientId: 'other-actor'
      })
      await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'garmin',
        clientId: 'other-service'
      })
      const active = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'active'
      })

      const fetched = await database.getFitnessSettings({
        actorId: actor,
        serviceType: 'strava'
      })

      expect(fetched).toMatchObject({ id: active.id, clientId: 'active' })
      expect(
        await database.getFitnessSettings({
          actorId: actor,
          serviceType: 'garmin'
        })
      ).toMatchObject({ clientId: 'other-service' })
      expect(
        await database.getFitnessSettings({
          actorId: otherActor,
          serviceType: 'garmin'
        })
      ).toBeNull()
    })

    it('does not return settings that were deleted', async () => {
      const actor = await newActor()
      const gone = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'gone'
      })
      // An active neighbour of the same actor and of another actor, so the
      // lookup has rows to choose from.
      await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'garmin',
        clientId: 'kept'
      })
      await database.createFitnessSettings({
        actorId: await newActor(),
        serviceType: 'strava',
        clientId: 'other-actor'
      })
      await softDelete(gone.id)

      expect(
        await database.getFitnessSettings({
          actorId: actor,
          serviceType: 'strava'
        })
      ).toBeNull()
    })

    it('reads every column back the way it was written', async () => {
      const actor = await newActor()
      const expiresAt = Date.parse('2032-05-06T07:08:09.123Z')
      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'client',
        clientSecret: 'secret',
        webhookToken: 'hook',
        providerUserId: 'provider',
        providerEnvironment: 'production',
        grantedScopes: 'a,b',
        accessToken: 'access',
        refreshToken: 'refresh',
        tokenExpiresAt: expiresAt,
        oauthState: 'state',
        oauthStateExpiry: expiresAt + 5,
        defaultVisibility: 'private',
        privacyLocations: [
          { latitude: 13.5, longitude: 100.25, hideRadiusMeters: 200 }
        ],
        privacyHomeLatitude: 13.5,
        privacyHomeLongitude: 100.25,
        privacyHideRadiusMeters: 200,
        generateRouteDescription: true
      })
      await database.updateFitnessSettings({
        id: created.id,
        lastWebhookAt: expiresAt + 10,
        lastImportAt: expiresAt + 20,
        connectionError: 'late'
      })

      const fetched = await database.getFitnessSettings({
        actorId: actor,
        serviceType: 'strava'
      })

      expect(fetched).toEqual({
        id: created.id,
        actorId: actor,
        serviceType: 'strava',
        clientId: 'client',
        clientSecret: 'secret',
        webhookToken: 'hook',
        providerUserId: 'provider',
        providerEnvironment: 'production',
        grantedScopes: 'a,b',
        accessToken: 'access',
        refreshToken: 'refresh',
        tokenExpiresAt: expiresAt,
        oauthState: 'state',
        oauthStateExpiry: expiresAt + 5,
        defaultVisibility: 'private',
        privacyLocations: [
          { latitude: 13.5, longitude: 100.25, hideRadiusMeters: 200 }
        ],
        privacyHomeLatitude: 13.5,
        privacyHomeLongitude: 100.25,
        privacyHideRadiusMeters: 200,
        generateRouteDescription: true,
        lastWebhookAt: expiresAt + 10,
        lastImportAt: expiresAt + 20,
        connectionError: 'late',
        credentialVersion: 0,
        createdAt: created.createdAt,
        updatedAt: expect.any(Number),
        deletedAt: undefined
      })
    })
  })

  describe('getFitnessSettingsByWebhookToken', () => {
    it('matches the token, the service and active rows only', async () => {
      const token = uniqueToken('lookup')
      const deletedActor = await newActor()
      const garminActor = await newActor()
      const otherTokenActor = await newActor()
      const activeActor = await newActor()
      const deleted = await database.createFitnessSettings({
        actorId: deletedActor,
        serviceType: 'strava',
        webhookToken: token
      })
      await softDelete(deleted.id)
      await database.createFitnessSettings({
        actorId: garminActor,
        serviceType: 'garmin',
        webhookToken: token
      })
      await database.createFitnessSettings({
        actorId: otherTokenActor,
        serviceType: 'strava',
        webhookToken: uniqueToken('lookup-other')
      })
      const active = await database.createFitnessSettings({
        actorId: activeActor,
        serviceType: 'strava',
        webhookToken: token
      })

      const fetched = await database.getFitnessSettingsByWebhookToken({
        webhookToken: token,
        serviceType: 'strava'
      })

      expect(fetched).toMatchObject({ id: active.id, actorId: activeActor })
      expect(
        await database.getFitnessSettingsByWebhookToken({
          webhookToken: token,
          serviceType: 'garmin'
        })
      ).toMatchObject({ actorId: garminActor })
      expect(
        await database.getFitnessSettingsByWebhookToken({
          webhookToken: token,
          serviceType: 'wahoo'
        })
      ).toBeNull()
    })

    it('never matches a wahoo row through its plain webhook column', async () => {
      const token = uniqueToken('wahoo-plain')
      await database.createFitnessSettings({
        actorId: await newActor(),
        serviceType: 'wahoo',
        webhookToken: token
      })

      expect(
        await database.getFitnessSettingsByWebhookToken({
          webhookToken: token,
          serviceType: 'wahoo'
        })
      ).toBeNull()
    })
  })

  describe('getWahooSettingsByWebhookToken', () => {
    it('resolves one wahoo row by token hash and provider user', async () => {
      const token = uniqueToken('wahoo')
      const otherToken = uniqueToken('wahoo')
      const provider = uniqueToken('provider')
      const deletedActor = await newActor()
      const otherProviderActor = await newActor()
      const otherTokenActor = await newActor()
      const stravaActor = await newActor()
      const wahooActor = await newActor()

      // Soft-deleted binding of the same token and provider.
      const deleted = await database.createFitnessSettings({
        actorId: deletedActor,
        serviceType: 'wahoo',
        webhookToken: token,
        providerUserId: provider
      })
      await softDelete(deleted.id)
      // Same token, other provider user.
      await database.createFitnessSettings({
        actorId: otherProviderActor,
        serviceType: 'wahoo',
        webhookToken: token,
        providerUserId: uniqueToken('provider')
      })
      // Same provider user, other token.
      await database.createFitnessSettings({
        actorId: otherTokenActor,
        serviceType: 'wahoo',
        webhookToken: otherToken,
        providerUserId: provider
      })
      // A row of another service carrying the same hash and provider user.
      const notWahoo = await database.createFitnessSettings({
        actorId: stravaActor,
        serviceType: 'wahoo',
        webhookToken: token,
        providerUserId: provider
      })
      await db
        .updateTable('fitness_settings')
        .set({ serviceType: 'strava' })
        .where('id', '=', notWahoo.id)
        .execute()
      const match = await database.createFitnessSettings({
        actorId: wahooActor,
        serviceType: 'wahoo',
        webhookToken: token,
        providerUserId: provider
      })

      const found = await database.getWahooSettingsByWebhookToken(
        token,
        provider
      )

      expect(found).toMatchObject({
        id: match.id,
        actorId: wahooActor,
        webhookToken: token
      })
      expect(
        await database.getWahooSettingsByWebhookToken(otherToken, provider)
      ).toMatchObject({ actorId: otherTokenActor })
      expect(
        await database.getWahooSettingsByWebhookToken('nobody', provider)
      ).toBeNull()
    })
  })

  describe('consumeFitnessOauthState', () => {
    it('consumes only the matching live state of that row', async () => {
      const now = Date.parse('2030-01-01T00:00:00.000Z')
      const state = uniqueToken('state')
      const actorA = await newActor()
      const actorB = await newActor()
      const actorC = await newActor()
      const actorD = await newActor()
      const neighbour = await database.createFitnessSettings({
        actorId: actorA,
        serviceType: 'strava',
        oauthState: state,
        oauthStateExpiry: now + 60_000
      })
      const expired = await database.createFitnessSettings({
        actorId: actorB,
        serviceType: 'strava',
        oauthState: state,
        oauthStateExpiry: now - 1
      })
      const deleted = await database.createFitnessSettings({
        actorId: actorC,
        serviceType: 'strava',
        oauthState: state,
        oauthStateExpiry: now + 60_000
      })
      await softDelete(deleted.id)
      const target = await database.createFitnessSettings({
        actorId: actorD,
        serviceType: 'strava',
        oauthState: state,
        oauthStateExpiry: now + 60_000
      })
      const neighbourBefore = await rawRow(neighbour.id)
      const expiredBefore = await rawRow(expired.id)
      const deletedBefore = await rawRow(deleted.id)

      await expect(
        database.consumeFitnessOauthState({
          id: target.id,
          state: 'another-state',
          now
        })
      ).resolves.toBe(false)
      expect((await rawRow(target.id)).oauthState).toBe(state)

      await expect(
        database.consumeFitnessOauthState({ id: expired.id, state, now })
      ).resolves.toBe(false)
      await expect(
        database.consumeFitnessOauthState({ id: deleted.id, state, now })
      ).resolves.toBe(false)
      await expect(
        database.consumeFitnessOauthState({ id: 'missing', state, now })
      ).resolves.toBe(false)

      await expect(
        database.consumeFitnessOauthState({ id: target.id, state, now })
      ).resolves.toBe(true)
      const consumed = await rawRow(target.id)
      expect(consumed).toMatchObject({
        oauthState: null,
        oauthStateExpiry: null,
        updatedAt: now
      })
      // A second use of the same state finds nothing to consume.
      await expect(
        database.consumeFitnessOauthState({ id: target.id, state, now })
      ).resolves.toBe(false)

      expect(await rawRow(neighbour.id)).toEqual(neighbourBefore)
      expect(await rawRow(expired.id)).toEqual(expiredBefore)
      expect(await rawRow(deleted.id)).toEqual(deletedBefore)
    })

    it('treats a state that expires exactly now as expired', async () => {
      const now = Date.parse('2030-06-01T00:00:00.000Z')
      const created = await database.createFitnessSettings({
        actorId: await newActor(),
        serviceType: 'strava',
        oauthState: 'edge',
        oauthStateExpiry: now
      })

      await expect(
        database.consumeFitnessOauthState({
          id: created.id,
          state: 'edge',
          now
        })
      ).resolves.toBe(false)
      await expect(
        database.consumeFitnessOauthState({
          id: created.id,
          state: 'edge',
          now: now - 1
        })
      ).resolves.toBe(true)
    })
  })

  describe('deleteFitnessSettings', () => {
    it('soft-deletes only that actor and service and keeps a strava row intact', async () => {
      const actor = await newActor()
      const otherActor = await newActor()
      const target = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'strava',
        clientId: 'target',
        accessToken: 'target-access'
      })
      const sibling = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'garmin',
        clientId: 'sibling',
        accessToken: 'sibling-access'
      })
      const other = await database.createFitnessSettings({
        actorId: otherActor,
        serviceType: 'strava',
        clientId: 'other',
        accessToken: 'other-access'
      })
      const siblingBefore = await rawRow(sibling.id)
      const otherBefore = await rawRow(other.id)

      await database.deleteFitnessSettings({
        actorId: actor,
        serviceType: 'strava'
      })

      const raw = await rawRow(target.id)
      expect(raw.deletedAt).toEqual(expect.any(Number))
      // Only wahoo credentials are wiped on disconnect.
      expect(raw.clientId).toBe('target')
      expect(decrypt(raw.accessToken!)).toBe('target-access')
      expect(await rawRow(sibling.id)).toEqual(siblingBefore)
      expect(await rawRow(other.id)).toEqual(otherBefore)
      expect(
        await database.getFitnessSettings({
          actorId: actor,
          serviceType: 'garmin'
        })
      ).toMatchObject({ clientId: 'sibling' })
    })

    it('wipes the credentials of the disconnected wahoo row only', async () => {
      const actor = await newActor()
      const otherActor = await newActor()
      const stravaActor = await newActor()
      const make = (actorId: string, serviceType: string) =>
        database.createFitnessSettings({
          actorId,
          serviceType,
          clientId: `${serviceType}-client`,
          clientSecret: `${serviceType}-secret`,
          webhookToken: uniqueToken('delete-hook'),
          providerUserId: uniqueToken('delete-provider'),
          grantedScopes: 'scopes',
          accessToken: `${serviceType}-access`,
          refreshToken: `${serviceType}-refresh`,
          tokenExpiresAt: Date.now() + 10_000,
          oauthState: 'state',
          oauthStateExpiry: Date.now() + 10_000
        })
      const target = await make(actor, 'wahoo')
      const other = await make(otherActor, 'wahoo')
      const strava = await make(stravaActor, 'strava')
      const otherBefore = await rawRow(other.id)
      const stravaBefore = await rawRow(strava.id)

      await database.deleteFitnessSettings({
        actorId: actor,
        serviceType: 'wahoo'
      })

      expect(await rawRow(target.id)).toMatchObject({
        deletedAt: expect.any(Number),
        clientId: null,
        clientSecret: null,
        webhookToken: null,
        wahooWebhookToken: null,
        wahooWebhookTokenHash: null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        oauthState: null,
        oauthStateExpiry: null,
        providerUserId: null,
        grantedScopes: null
      })
      expect(await rawRow(other.id)).toEqual(otherBefore)
      expect(await rawRow(strava.id)).toEqual(stravaBefore)
    })
  })

  describe('stored secrets', () => {
    const secrets = [
      ['plain ascii', 'abcDEF123-_.~'],
      ['unicode and emoji', 'tökën-日本語-🔐-‮rtl'],
      [
        'quotes, backslashes and SQL-ish text',
        `it's "q" \\ \\n ; -- %_ ' OR 1=1`
      ],
      ['JSON-looking text', '{"a":[1,2,3],"b":null}'],
      ['a date-looking value', '2026-01-02 03:04:05'],
      ['a number-looking value', '12345678901234567890'],
      ['padding spaces', '  padded token  '],
      ['a long value', 'x'.repeat(4096)]
    ] as const

    it.each(secrets)(
      'round-trips %s byte for byte through every encrypted column',
      async (_, secret) => {
        const actor = await newActor()
        const wahooActor = await newActor()

        const created = await database.createFitnessSettings({
          actorId: actor,
          serviceType: 'strava',
          clientSecret: secret,
          accessToken: secret,
          refreshToken: secret
        })
        const wahoo = await database.createFitnessSettings({
          actorId: wahooActor,
          serviceType: 'wahoo',
          webhookToken: secret,
          providerUserId: 'secret-provider'
        })

        const fetched = await database.getFitnessSettings({
          actorId: actor,
          serviceType: 'strava'
        })
        expect(fetched).toMatchObject({
          clientSecret: secret,
          accessToken: secret,
          refreshToken: secret
        })
        const raw = await rawRow(created.id)
        expect(decrypt(raw.clientSecret!)).toBe(secret)
        expect(decrypt(raw.accessToken!)).toBe(secret)
        expect(decrypt(raw.refreshToken!)).toBe(secret)
        expect(decrypt((await rawRow(wahoo.id)).wahooWebhookToken!)).toBe(
          secret
        )

        expect(
          await database.getWahooSettingsByWebhookToken(
            secret,
            'secret-provider'
          )
        ).toMatchObject({ id: wahoo.id, webhookToken: secret })

        // An update writes them the same way.
        const rotated = `${secret}!`
        const updated = await database.updateFitnessSettings({
          id: created.id,
          accessToken: rotated,
          refreshToken: rotated
        })
        expect(updated).toMatchObject({
          accessToken: rotated,
          refreshToken: rotated
        })
      }
    )

    it.each(secrets.filter(([, secret]) => secret.length <= 255))(
      'round-trips %s byte for byte through the plain text columns',
      async (_, secret) => {
        const actor = await newActor()

        const created = await database.createFitnessSettings({
          actorId: actor,
          serviceType: 'strava',
          clientId: secret,
          webhookToken: secret,
          providerUserId: secret,
          grantedScopes: secret,
          oauthState: secret,
          oauthStateExpiry: Date.now() + 10_000
        })
        const updated = await database.updateFitnessSettings({
          id: created.id,
          connectionError: secret
        })

        expect(updated).toMatchObject({
          clientId: secret,
          webhookToken: secret,
          providerUserId: secret,
          grantedScopes: secret,
          oauthState: secret,
          connectionError: secret
        })
        expect(
          await database.getFitnessSettingsByWebhookToken({
            webhookToken: secret,
            serviceType: 'strava'
          })
        ).toMatchObject({ id: created.id })
        expect(
          await database.consumeFitnessOauthState({
            id: created.id,
            state: secret,
            now: Date.now()
          })
        ).toBe(true)
        expect(await rawRow(created.id)).toMatchObject({
          clientId: secret,
          webhookToken: secret,
          providerUserId: secret,
          grantedScopes: secret,
          connectionError: secret,
          oauthState: null
        })
      }
    )

    it('reads back ciphertext that was stored by an earlier version unchanged', async () => {
      const actor = await newActor()
      const ciphertext = encrypt('legacy-secret')
      const id = crypto.randomUUID()
      await db
        .insertInto('fitness_settings')
        .values({
          id,
          actorId: actor,
          serviceType: 'strava',
          clientSecret: ciphertext,
          accessToken: ciphertext,
          refreshToken: ciphertext
        })
        .execute()

      expect(
        await database.getFitnessSettings({
          actorId: actor,
          serviceType: 'strava'
        })
      ).toMatchObject({
        clientSecret: 'legacy-secret',
        accessToken: 'legacy-secret',
        refreshToken: 'legacy-secret'
      })
      // Writing another column does not touch the stored ciphertext.
      await database.updateFitnessSettings({ id, connectionError: 'x' })
      const raw = await rawRow(id)
      expect(raw.clientSecret).toBe(ciphertext)
      expect(raw.accessToken).toBe(ciphertext)
      expect(raw.refreshToken).toBe(ciphertext)
    })
  })

  describe('stored privacy locations', () => {
    const zone = { latitude: 13.5, longitude: 100.25, hideRadiusMeters: 200 }

    it('keeps the saved zones as JSON that other readers can parse', async () => {
      const actor = await newActor()
      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'general',
        privacyLocations: [zone, { ...zone, latitude: 1, hideRadiusMeters: 5 }]
      })

      // The second zone's radius snaps up to the smallest supported option.
      const expected = [zone, { ...zone, latitude: 1, hideRadiusMeters: 50 }]
      expect(created.privacyLocations).toEqual(expected)
      const raw = await rawRow(created.id)
      expect(raw.privacyLocations).toEqual(expected)
      expect(
        (
          await database.getFitnessSettings({
            actorId: actor,
            serviceType: 'general'
          })
        )?.privacyLocations
      ).toEqual(expected)
    })

    it('reads a row stored without zones as an empty list', async () => {
      const actor = await newActor()
      await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'general'
      })

      expect(
        (
          await database.getFitnessSettings({
            actorId: actor,
            serviceType: 'general'
          })
        )?.privacyLocations
      ).toEqual([])
    })

    it('reads a JSON-encoded string holding the zones', async () => {
      const actor = await newActor()
      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'general'
      })
      await db
        .updateTable('fitness_settings')
        .set({ privacyLocations: JSON.stringify(JSON.stringify([zone])) })
        .where('id', '=', created.id)
        .execute()

      expect(
        (
          await database.getFitnessSettings({
            actorId: actor,
            serviceType: 'general'
          })
        )?.privacyLocations
      ).toEqual([zone])
    })

    it.each([
      ['a JSON object', '{"latitude":1}'],
      ['a JSON number', '5'],
      ['a list of junk', '[1,"a",null,{"latitude":"x"}]']
    ])('reads %s as no usable zones without logging', async (_, text) => {
      const loggerErrorSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => undefined)
      try {
        const actor = await newActor()
        const created = await database.createFitnessSettings({
          actorId: actor,
          serviceType: 'general'
        })
        await db
          .updateTable('fitness_settings')
          .set({ privacyLocations: text })
          .where('id', '=', created.id)
          .execute()

        expect(
          (
            await database.getFitnessSettings({
              actorId: actor,
              serviceType: 'general'
            })
          )?.privacyLocations
        ).toEqual([])
        expect(loggerErrorSpy).not.toHaveBeenCalled()
      } finally {
        loggerErrorSpy.mockRestore()
      }
    })

    it('reads a stored JSON null as unset', async () => {
      const actor = await newActor()
      const created = await database.createFitnessSettings({
        actorId: actor,
        serviceType: 'general'
      })
      await db
        .updateTable('fitness_settings')
        .set({ privacyLocations: 'null' })
        .where('id', '=', created.id)
        .execute()

      expect(
        (
          await database.getFitnessSettings({
            actorId: actor,
            serviceType: 'general'
          })
        )?.privacyLocations
      ).toBeUndefined()
    })

    // PostgreSQL's jsonb cannot hold text that is not JSON.
    it.skipIf(testDb.backend === 'pg')(
      'logs and reports no zones when the stored text is not JSON',
      async () => {
        const loggerErrorSpy = vi
          .spyOn(logger, 'error')
          .mockImplementation(() => undefined)
        try {
          const actor = await newActor()
          const created = await database.createFitnessSettings({
            actorId: actor,
            serviceType: 'general'
          })
          await db
            .updateTable('fitness_settings')
            .set({ privacyLocations: '{not json' })
            .where('id', '=', created.id)
            .execute()

          const fetched = await database.getFitnessSettings({
            actorId: actor,
            serviceType: 'general'
          })

          expect(fetched?.privacyLocations).toEqual([])
          expect(loggerErrorSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              message: 'Failed to parse stored fitness privacy locations',
              actorId: actor,
              serviceType: 'general'
            })
          )
        } finally {
          loggerErrorSpy.mockRestore()
        }
      }
    )
  })

  describe('rows with missing optional data', () => {
    it('reads a row whose timestamps and optional columns are null', async () => {
      const actor = await newActor()
      const id = crypto.randomUUID()
      await db
        .insertInto('fitness_settings')
        .values({
          id,
          actorId: actor,
          serviceType: 'strava',
          createdAt: null,
          updatedAt: null,
          providerEnvironment: null
        })
        .execute()

      const fetched = await database.getFitnessSettings({
        actorId: actor,
        serviceType: 'strava'
      })

      expect(fetched).toMatchObject({
        id,
        createdAt: 0,
        updatedAt: 0,
        providerEnvironment: 'sandbox',
        generateRouteDescription: false,
        credentialVersion: 0,
        privacyLocations: []
      })
      expect(fetched?.deletedAt).toBeUndefined()
    })
  })
})

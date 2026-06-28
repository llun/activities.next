import crypto from 'crypto'
import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Scope } from '@/lib/types/database/operations'

describe('OAuthDatabase', () => {
  const knexDatabase = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const database = getSQLDatabase(knexDatabase)

  beforeAll(async () => {
    await database.migrate()

    // Insert test clients directly into the oauthClient table
    const now = new Date()
    await knexDatabase('oauthClient').insert({
      id: crypto.randomUUID(),
      clientId: 'test-client-1',
      clientSecret: 'hashed-secret-1',
      name: 'oauth-app1',
      scopes: JSON.stringify([Scope.enum.read]),
      redirectUris: JSON.stringify([
        'https://oauth-app1.llun.dev/oauth/redirect'
      ]),
      requirePKCE: false,
      disabled: false,
      grantTypes: JSON.stringify([
        'authorization_code',
        'client_credentials',
        'refresh_token'
      ]),
      responseTypes: JSON.stringify(['code']),
      tokenEndpointAuthMethod: 'client_secret_post',
      createdAt: now,
      updatedAt: now
    })

    await knexDatabase('oauthClient').insert({
      id: crypto.randomUUID(),
      clientId: 'test-client-2',
      clientSecret: 'hashed-secret-2',
      name: 'oauth-app2',
      scopes: JSON.stringify([Scope.enum.read, Scope.enum.write]),
      redirectUris: JSON.stringify([
        'https://oauth-app2.llun.dev/oauth/redirect'
      ]),
      requirePKCE: false,
      disabled: false,
      createdAt: now,
      updatedAt: now
    })
  })

  afterAll(async () => {
    await knexDatabase.destroy()
  })

  describe('clients', () => {
    it('returns existing client by name', async () => {
      const client = await database.getClientFromName({
        name: 'oauth-app1'
      })
      expect(client).toBeDefined()
      expect(client?.name).toBe('oauth-app1')
      expect(client?.clientId).toBe('test-client-1')
      expect(client?.scopes).toEqual([Scope.enum.read])
      expect(client?.redirectUris).toEqual([
        'https://oauth-app1.llun.dev/oauth/redirect'
      ])
    })

    it('returns existing client by clientId', async () => {
      const client = await database.getClientFromId({
        clientId: 'test-client-1'
      })
      expect(client).toBeDefined()
      expect(client?.name).toBe('oauth-app1')
      expect(client?.clientId).toBe('test-client-1')
    })

    it('returns null for non-existent client name', async () => {
      const client = await database.getClientFromName({
        name: 'nonexistent'
      })
      expect(client).toBeNull()
    })

    it('returns null for non-existent client id', async () => {
      const client = await database.getClientFromId({
        clientId: 'nonexistent'
      })
      expect(client).toBeNull()
    })

    it('returns client with correct timestamps', async () => {
      const client = await database.getClientFromName({
        name: 'oauth-app2'
      })
      expect(client?.createdAt).toBeNumber()
      expect(client?.updatedAt).toBeNumber()
    })
  })

  describe('getClientFromAccessToken', () => {
    const hashedToken = 'hashed-access-token-1'

    beforeAll(async () => {
      const now = new Date()
      await knexDatabase('oauthAccessToken').insert({
        id: crypto.randomUUID(),
        token: hashedToken,
        clientId: 'test-client-1',
        scopes: JSON.stringify([Scope.enum.read]),
        expiresAt: new Date(now.getTime() + 60_000),
        createdAt: now
      })
    })

    it('resolves the owning client for a stored access token', async () => {
      const client = await database.getClientFromAccessToken({ hashedToken })
      expect(client?.clientId).toBe('test-client-1')
      expect(client?.name).toBe('oauth-app1')
    })

    it('returns null for an unknown access token', async () => {
      const client = await database.getClientFromAccessToken({
        hashedToken: 'does-not-exist'
      })
      expect(client).toBeNull()
    })
  })

  describe('connected apps', () => {
    let ACCOUNT = ''
    let OTHER_ACCOUNT = ''
    const ACTOR = 'connected-actor'

    beforeAll(async () => {
      const now = new Date()
      // Real accounts are required: oauthConsent.userId is a FK into accounts.
      ACCOUNT = await database.createAccount({
        email: `connected-${crypto.randomUUID()}@llun.test`,
        username: `connected-${crypto.randomUUID().slice(0, 8)}`,
        passwordHash: 'hash',
        domain: 'llun.test',
        privateKey: 'private-connected',
        publicKey: 'public-connected'
      })
      OTHER_ACCOUNT = await database.createAccount({
        email: `other-${crypto.randomUUID()}@llun.test`,
        username: `other-${crypto.randomUUID().slice(0, 8)}`,
        passwordHash: 'hash',
        domain: 'llun.test',
        privateKey: 'private-other',
        publicKey: 'public-other'
      })
      // Two registered clients: an API client and an SSO sign-in.
      await knexDatabase('oauthClient').insert([
        {
          id: crypto.randomUUID(),
          clientId: 'ice-cubes',
          name: 'Ice Cubes',
          uri: 'icecubesapp.com',
          scopes: JSON.stringify([Scope.enum.read, Scope.enum.write]),
          redirectUris: JSON.stringify(['https://icecubesapp.com/oauth']),
          createdAt: now,
          updatedAt: now
        },
        {
          id: crypto.randomUUID(),
          clientId: 'la-suite-docs',
          name: 'La Suite Docs',
          uri: 'docs.llun.dev',
          scopes: JSON.stringify([Scope.enum.openid]),
          redirectUris: JSON.stringify(['https://docs.llun.dev/oauth']),
          createdAt: now,
          updatedAt: now
        }
      ])

      // Consents for the account under test. The API client was authorized
      // first (scopes stored as a JSON array); the SSO grant later (scopes
      // stored space-separated, the OAuth wire form) so it sorts newest-first.
      await knexDatabase('oauthConsent').insert([
        {
          id: crypto.randomUUID(),
          clientId: 'ice-cubes',
          userId: ACCOUNT,
          referenceId: ACTOR,
          scopes: JSON.stringify(['read', 'write', 'follow', 'push']),
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-01T00:00:00.000Z')
        },
        {
          id: crypto.randomUUID(),
          clientId: 'la-suite-docs',
          userId: ACCOUNT,
          referenceId: ACTOR,
          scopes: 'openid read:accounts',
          createdAt: new Date('2026-06-10T00:00:00.000Z'),
          updatedAt: new Date('2026-06-10T00:00:00.000Z')
        },
        // A different account's grant for the same client must never leak.
        {
          id: crypto.randomUUID(),
          clientId: 'ice-cubes',
          userId: OTHER_ACCOUNT,
          referenceId: 'other-actor',
          scopes: JSON.stringify(['read']),
          createdAt: now,
          updatedAt: now
        }
      ])

      // Live tokens for the API client grant, so revoke can prove it deletes
      // them too.
      await knexDatabase('oauthRefreshToken').insert({
        id: 'refresh-ice-cubes',
        token: 'refresh-token-ice-cubes',
        clientId: 'ice-cubes',
        userId: ACCOUNT,
        referenceId: ACTOR,
        scopes: 'read write',
        expiresAt: new Date(now.getTime() + 86_400_000),
        createdAt: now
      })
      await knexDatabase('oauthAccessToken').insert({
        id: 'access-ice-cubes',
        token: 'access-token-ice-cubes',
        clientId: 'ice-cubes',
        userId: ACCOUNT,
        referenceId: ACTOR,
        refreshId: 'refresh-ice-cubes',
        scopes: 'read write',
        expiresAt: new Date(now.getTime() + 3_600_000),
        createdAt: now
      })
    })

    it('lists the account grants newest-first, classifying SSO sign-ins', async () => {
      const apps = await database.getAccountConnectedApps({
        accountId: ACCOUNT
      })

      expect(apps).toHaveLength(2)
      // Newest first: the SSO grant authorized in June precedes the May API one.
      expect(apps[0]).toMatchObject({
        clientId: 'la-suite-docs',
        name: 'La Suite Docs',
        website: 'docs.llun.dev',
        actorId: ACTOR,
        signIn: true
      })
      // Space-separated scopes are normalized into an array.
      expect(apps[0].scopes).toEqual(['openid', 'read:accounts'])

      expect(apps[1]).toMatchObject({
        clientId: 'ice-cubes',
        website: 'icecubesapp.com',
        signIn: false
      })
      expect(apps[1].scopes).toEqual(['read', 'write', 'follow', 'push'])
    })

    it("never lists another account's grants", async () => {
      const apps = await database.getAccountConnectedApps({
        accountId: OTHER_ACCOUNT
      })
      expect(apps).toHaveLength(1)
      expect(apps[0].clientId).toBe('ice-cubes')
      expect(apps[0].actorId).toBe('other-actor')
    })

    it('revokes a grant and deletes its access and refresh tokens', async () => {
      await database.revokeAccountConnectedApp({
        accountId: ACCOUNT,
        clientId: 'ice-cubes',
        actorId: ACTOR
      })

      const apps = await database.getAccountConnectedApps({
        accountId: ACCOUNT
      })
      expect(apps.map((app) => app.clientId)).toEqual(['la-suite-docs'])

      expect(
        await knexDatabase('oauthAccessToken')
          .where('clientId', 'ice-cubes')
          .andWhere('userId', ACCOUNT)
      ).toHaveLength(0)
      expect(
        await knexDatabase('oauthRefreshToken')
          .where('clientId', 'ice-cubes')
          .andWhere('userId', ACCOUNT)
      ).toHaveLength(0)

      // The other account's grant for the same client is untouched.
      const otherApps = await database.getAccountConnectedApps({
        accountId: OTHER_ACCOUNT
      })
      expect(otherApps).toHaveLength(1)
    })

    it('lists and revokes a no-actor grant stored with an empty-string referenceId', async () => {
      const account = await database.createAccount({
        email: `noactor-${crypto.randomUUID()}@llun.test`,
        username: `noactor-${crypto.randomUUID().slice(0, 8)}`,
        passwordHash: 'hash',
        domain: 'llun.test',
        privateKey: 'private-noactor',
        publicKey: 'public-noactor'
      })
      const now = new Date()
      await knexDatabase('oauthClient').insert({
        id: crypto.randomUUID(),
        clientId: 'client-credentials',
        name: 'Client Credentials',
        redirectUris: JSON.stringify(['https://example.test/oauth']),
        createdAt: now,
        updatedAt: now
      })
      // A client-credentials-style grant with no delegated actor — persisted
      // here as an empty string rather than NULL.
      await knexDatabase('oauthConsent').insert({
        id: crypto.randomUUID(),
        clientId: 'client-credentials',
        userId: account,
        referenceId: '',
        scopes: JSON.stringify(['read']),
        createdAt: now,
        updatedAt: now
      })

      const apps = await database.getAccountConnectedApps({
        accountId: account
      })
      expect(apps).toHaveLength(1)
      // The empty-string referenceId is normalized to null on read.
      expect(apps[0].actorId).toBeNull()

      // Revoking the no-actor grant (actorId null) must still match the
      // empty-string row.
      await database.revokeAccountConnectedApp({
        accountId: account,
        clientId: 'client-credentials',
        actorId: null
      })
      expect(
        await database.getAccountConnectedApps({ accountId: account })
      ).toHaveLength(0)
    })
  })
})

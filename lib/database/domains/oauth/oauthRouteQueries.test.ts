import crypto from 'crypto'
import { sql } from 'kysely'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

// The OAuth reads and writes the bearer guard, the token endpoint and the app
// registration endpoint make: the access token by hash, the PKCE requirement,
// the registration throttle's count and the registration insert. Each runs
// against neighbouring rows it must not touch, and `expiresAt` / `createdAt`
// are pinned as epoch milliseconds on both backends. Runs on PostgreSQL in CI.

const testDb = createTestDatabase()
const { database } = testDb
const db = () => testDb.db
const isSqlite = () => testDb.backend === 'sqlite'

const CLIENT_ID = 'route-queries-client'
const OTHER_CLIENT_ID = 'route-queries-other-client'
const SEEDED_AT = new Date('2026-03-04T05:06:07.000Z')
const EXPIRES_AT = new Date('2026-05-06T07:08:09.123Z')

let accountId: string

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
  accountId = await database.createAccount({
    email: 'route-queries@oauth.test',
    username: 'route-queries',
    passwordHash: 'hash',
    domain: 'oauth.test',
    privateKey: 'private',
    publicKey: 'public'
  })
  for (const clientId of [CLIENT_ID, OTHER_CLIENT_ID]) {
    await db()
      .insertInto('oauthClient')
      .values({ id: `row-${clientId}`, clientId, redirectUris: '[]' })
      .execute()
  }
})

afterAll(async () => {
  await database.destroy()
})

type TokenRow = {
  token: string
  userId?: string | null
  referenceId?: string | null
  scopes?: string
  expiresAt?: Date
  revoked?: Date | null
  clientId?: string
}

const addToken = async ({
  token,
  userId = accountId,
  referenceId = null,
  scopes = JSON.stringify(['read']),
  expiresAt = EXPIRES_AT,
  revoked = null,
  clientId = CLIENT_ID
}: TokenRow) => {
  await db()
    .insertInto('oauthAccessToken')
    .values({
      id: crypto.randomUUID(),
      token,
      clientId,
      userId,
      referenceId,
      scopes,
      expiresAt,
      revoked,
      createdAt: SEEDED_AT
    })
    .execute()
}

describe('getOAuthAccessTokenByHash', () => {
  beforeEach(async () => {
    await db().deleteFrom('oauthAccessToken').execute()
  })

  it('returns the stored token by its hash, and only the columns the guard reads', async () => {
    await addToken({
      token: 'hash-a',
      referenceId: 'https://oauth.test/users/route-queries',
      scopes: 'read write'
    })
    await addToken({ token: 'hash-b', scopes: JSON.stringify(['follow']) })

    const found = await database.getOAuthAccessTokenByHash({
      hashedToken: 'hash-a'
    })

    expect(found).toEqual({
      clientId: CLIENT_ID,
      userId: accountId,
      referenceId: 'https://oauth.test/users/route-queries',
      scopes: 'read write',
      expiresAt: EXPIRES_AT.getTime()
    })
    expect(typeof found?.expiresAt).toBe('number')
  })

  it('answers null for a hash no token is stored under', async () => {
    await addToken({ token: 'hash-a' })

    expect(
      await database.getOAuthAccessTokenByHash({ hashedToken: 'hash-missing' })
    ).toBeNull()
    expect(
      await database.getOAuthAccessTokenByHash({ hashedToken: 'HASH-A' })
    ).toBeNull()
  })

  it('returns the owner and actor of an app token as null, and an empty actor reference as it was stored', async () => {
    await addToken({ token: 'app-token', userId: null, referenceId: null })
    await addToken({ token: 'empty-reference', referenceId: '' })

    await expect(
      database.getOAuthAccessTokenByHash({ hashedToken: 'app-token' })
    ).resolves.toMatchObject({ userId: null, referenceId: null })
    await expect(
      database.getOAuthAccessTokenByHash({ hashedToken: 'empty-reference' })
    ).resolves.toMatchObject({ referenceId: '' })
  })

  it('reads the expiry as epoch milliseconds that order like the instants they stand for', async () => {
    const now = Date.now()
    await addToken({ token: 'past', expiresAt: new Date(now - 1000) })
    await addToken({ token: 'future', expiresAt: new Date(now + 3_600_000) })

    const past = await database.getOAuthAccessTokenByHash({
      hashedToken: 'past'
    })
    const future = await database.getOAuthAccessTokenByHash({
      hashedToken: 'future'
    })

    expect(past?.expiresAt).toBe(now - 1000)
    expect(future?.expiresAt).toBe(now + 3_600_000)
    expect(new Date(past!.expiresAt) < new Date()).toBe(true)
    expect(new Date(future!.expiresAt) < new Date()).toBe(false)
  })

  it('still returns a token better-auth soft-revoked: the guard does not honour `revoked`', async () => {
    await addToken({ token: 'revoked', revoked: new Date(EXPIRES_AT) })

    await expect(
      database.getOAuthAccessTokenByHash({ hashedToken: 'revoked' })
    ).resolves.toMatchObject({ expiresAt: EXPIRES_AT.getTime() })
  })

  it.runIf(isSqlite())(
    'reads a SQLite expiry stored as zone-less UTC text or as epoch milliseconds the same way',
    async () => {
      await addToken({ token: 'as-text' })
      await addToken({ token: 'as-number' })
      await sql`update "oauthAccessToken" set "expiresAt" = '2026-05-06 07:08:09' where "token" = 'as-text'`.execute(
        db()
      )
      await sql`update "oauthAccessToken" set "expiresAt" = ${EXPIRES_AT.getTime()} where "token" = 'as-number'`.execute(
        db()
      )

      await expect(
        database.getOAuthAccessTokenByHash({ hashedToken: 'as-text' })
      ).resolves.toMatchObject({
        expiresAt: Date.UTC(2026, 4, 6, 7, 8, 9)
      })
      await expect(
        database.getOAuthAccessTokenByHash({ hashedToken: 'as-number' })
      ).resolves.toMatchObject({ expiresAt: EXPIRES_AT.getTime() })
    }
  )
})

describe('isOAuthClientPKCERequired', () => {
  const setPkce = (clientId: string, requirePKCE: boolean | null) =>
    db()
      .updateTable('oauthClient')
      .set({ requirePKCE })
      .where('clientId', '=', clientId)
      .execute()

  it('is true only for a client registered with requirePKCE', async () => {
    await setPkce(CLIENT_ID, true)
    await setPkce(OTHER_CLIENT_ID, false)

    await expect(
      database.isOAuthClientPKCERequired({ clientId: CLIENT_ID })
    ).resolves.toBe(true)
    await expect(
      database.isOAuthClientPKCERequired({ clientId: OTHER_CLIENT_ID })
    ).resolves.toBe(false)
  })

  it('is false for a client whose requirePKCE was never set and for one that is not registered', async () => {
    await setPkce(CLIENT_ID, null)

    await expect(
      database.isOAuthClientPKCERequired({ clientId: CLIENT_ID })
    ).resolves.toBe(false)
    await expect(
      database.isOAuthClientPKCERequired({ clientId: 'not-registered' })
    ).resolves.toBe(false)
  })

  it('answers for a client whose JSON columns are malformed, which getClientFromId refuses', async () => {
    const clientId = 'malformed-client'
    await db()
      .insertInto('oauthClient')
      .values({
        id: 'row-malformed-client',
        clientId,
        redirectUris: 'not json',
        scopes: 'not json either',
        requirePKCE: true
      })
      .execute()

    await expect(
      database.isOAuthClientPKCERequired({ clientId })
    ).resolves.toBe(true)
    await expect(database.getClientFromId({ clientId })).rejects.toThrow()
  })
})

describe('countRecentAppRegistrations', () => {
  const REFERENCE = 'app-registration:203.0.113.7'
  const SINCE = Date.UTC(2026, 5, 7, 8, 0, 0)

  const addRegistration = (
    label: string,
    referenceId: string,
    createdAt: number
  ) =>
    db()
      .insertInto('oauthClient')
      .values({
        id: `registration-${label}`,
        clientId: `registration-${label}`,
        redirectUris: '[]',
        referenceId,
        createdAt: new Date(createdAt)
      })
      .execute()

  beforeAll(async () => {
    await addRegistration('before', REFERENCE, SINCE - 1)
    await addRegistration('at', REFERENCE, SINCE)
    await addRegistration('after', REFERENCE, SINCE + 1)
    await addRegistration('later', REFERENCE, SINCE + 60_000)
    await addRegistration(
      'other-source',
      'app-registration:203.0.113.8',
      SINCE + 1
    )
    await addRegistration('no-source', '', SINCE + 1)
  })

  it('counts one source’s registrations from `since` on, the boundary instant included', async () => {
    const count = await database.countRecentAppRegistrations({
      registrationReference: REFERENCE,
      since: SINCE
    })

    expect(count).toBe(3)
    expect(typeof count).toBe('number')
  })

  it('moves with `since` to the millisecond', async () => {
    await expect(
      database.countRecentAppRegistrations({
        registrationReference: REFERENCE,
        since: SINCE - 1
      })
    ).resolves.toBe(4)
    await expect(
      database.countRecentAppRegistrations({
        registrationReference: REFERENCE,
        since: SINCE + 1
      })
    ).resolves.toBe(2)
    await expect(
      database.countRecentAppRegistrations({
        registrationReference: REFERENCE,
        since: SINCE + 60_001
      })
    ).resolves.toBe(0)
  })

  it('is zero for a source that never registered, and ignores the other sources', async () => {
    await expect(
      database.countRecentAppRegistrations({
        registrationReference: 'app-registration:198.51.100.1',
        since: SINCE
      })
    ).resolves.toBe(0)
    await expect(
      database.countRecentAppRegistrations({
        registrationReference: 'app-registration:203.0.113.8',
        since: SINCE
      })
    ).resolves.toBe(1)
  })
})

describe('createOAuthClientRegistration', () => {
  const CREATED_AT = Date.UTC(2026, 6, 8, 9, 10, 11, 123)

  const registration = (id: string) => ({
    id,
    clientId: `client-${id}`,
    clientSecret: 'hashed-secret',
    name: 'Phanpy',
    scopes: ['read', 'write'],
    clientCredentialsScopes: ['read', 'write'],
    redirectUris: ['https://phanpy.test/callback', 'phanpy://callback'],
    postLogoutRedirectUris: null,
    enableEndSession: false,
    website: 'https://phanpy.test',
    requirePKCE: false,
    disabled: false,
    grantTypes: ['authorization_code', 'client_credentials'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_post',
    referenceId: 'app-registration:203.0.113.9',
    metadata: JSON.stringify({ registeredUnauthenticated: true }),
    createdAt: CREATED_AT
  })

  const row = (id: string) =>
    db()
      .selectFrom('oauthClient')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow()

  it('stores every column of the registration, the lists as JSON-array strings', async () => {
    await database.createOAuthClientRegistration(registration('full'))

    expect(await row('full')).toMatchObject({
      id: 'full',
      clientId: 'client-full',
      clientSecret: 'hashed-secret',
      name: 'Phanpy',
      scopes: '["read","write"]',
      clientCredentialsScopes: '["read","write"]',
      redirectUris: '["https://phanpy.test/callback","phanpy://callback"]',
      postLogoutRedirectUris: null,
      enableEndSession: false,
      uri: 'https://phanpy.test',
      requirePKCE: false,
      disabled: false,
      grantTypes: '["authorization_code","client_credentials"]',
      responseTypes: '["code"]',
      tokenEndpointAuthMethod: 'client_secret_post',
      referenceId: 'app-registration:203.0.113.9',
      metadata: '{"registeredUnauthenticated":true}',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    })
  })

  it('stores the post-logout redirect URIs when end-session is enabled, and a missing website as null', async () => {
    await database.createOAuthClientRegistration({
      ...registration('end-session'),
      postLogoutRedirectUris: ['https://phanpy.test/signed-out'],
      enableEndSession: true,
      website: null
    })

    expect(await row('end-session')).toMatchObject({
      postLogoutRedirectUris: '["https://phanpy.test/signed-out"]',
      enableEndSession: true,
      uri: null
    })
  })

  it('writes a client getClientFromId reads back, and the throttle counts it', async () => {
    await database.createOAuthClientRegistration(registration('readback'))

    await expect(
      database.getClientFromId({ clientId: 'client-readback' })
    ).resolves.toMatchObject({
      id: 'readback',
      clientId: 'client-readback',
      clientSecret: 'hashed-secret',
      name: 'Phanpy',
      scopes: ['read', 'write'],
      redirectUris: ['https://phanpy.test/callback', 'phanpy://callback'],
      website: 'https://phanpy.test',
      requirePKCE: false,
      disabled: false,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    })
    await expect(
      database.countRecentAppRegistrations({
        registrationReference: 'app-registration:203.0.113.9',
        since: CREATED_AT
      })
    ).resolves.toBeGreaterThanOrEqual(1)
  })

  it('refuses a second registration of the same client id and keeps the first', async () => {
    await database.createOAuthClientRegistration(registration('first'))

    await expect(
      database.createOAuthClientRegistration({
        ...registration('second'),
        clientId: 'client-first'
      })
    ).rejects.toThrow()

    expect(await row('first')).toMatchObject({ clientSecret: 'hashed-secret' })
    await expect(
      db()
        .selectFrom('oauthClient')
        .select('id')
        .where('id', '=', 'second')
        .executeTakeFirst()
    ).resolves.toBeUndefined()
  })
})

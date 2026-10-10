import crypto from 'crypto'
import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { SESSION_ID_CHUNK_SIZE } from '@/lib/database/sql/utils/detachOAuthTokensFromSessions'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

// SQLite leaves foreign keys OFF by default, so the shared test database
// never enforces them — which is exactly why the session ↔ OAuth-token FK
// violation only surfaced on PostgreSQL in production. Spin up an isolated
// database with enforcement ON so these tests reproduce that constraint.
// These tests never touch the shared per-backend `database`, so they live in
// their own top-level describe and run once.
const createForeignKeyEnforcingDatabase = () =>
  knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' },
    pool: {
      afterCreate: (
        conn: { pragma: (statement: string) => void },
        done: (error: Error | null, conn: unknown) => void
      ) => {
        conn.pragma('foreign_keys = ON')
        done(null, conn)
      }
    }
  })

// Mint an OAuth access + refresh token bound to `sessionId`, mirroring the
// rows better-auth's OAuth provider writes when an app is authorized. Both
// tables carry a `sessionId` FK into `sessions.id`.
const seedOAuthTokensForSession = async (
  knexDatabase: ReturnType<typeof knex>,
  {
    accountId,
    sessionId,
    suffix
  }: { accountId: string; sessionId: string; suffix: string }
) => {
  const clientId = `client-${suffix}`
  await knexDatabase('oauthClient').insert({
    id: crypto.randomUUID(),
    clientId,
    redirectUris: '[]'
  })
  const refreshId = crypto.randomUUID()
  await knexDatabase('oauthRefreshToken').insert({
    id: refreshId,
    token: `refresh-${suffix}`,
    clientId,
    userId: accountId,
    sessionId,
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: 'read'
  })
  const accessId = crypto.randomUUID()
  await knexDatabase('oauthAccessToken').insert({
    id: accessId,
    token: `access-${suffix}`,
    clientId,
    userId: accountId,
    sessionId,
    refreshId,
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: 'read'
  })
  return { accessId, refreshId }
}

describe('account sessions that minted OAuth tokens (foreign keys enforced)', () => {
  let knexDatabase: ReturnType<typeof createForeignKeyEnforcingDatabase>
  let sqlDatabase: ReturnType<typeof getSQLDatabase>

  const createAccount = (prefix: string) => {
    const email = `${prefix}-${crypto.randomUUID()}@${TEST_DOMAIN}`
    return sqlDatabase
      .createAccount({
        email,
        username: `${prefix}-${crypto.randomUUID().slice(0, 8)}`,
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: `private-${prefix}-key`,
        publicKey: `public-${prefix}-key`
      })
      .then((accountId) => ({ accountId, email }))
  }

  // Creates a session for `accountId` and binds a fresh OAuth access + refresh
  // token pair to it.
  const createSessionWithOAuthTokens = async (
    accountId: string,
    token: string
  ) => {
    await sqlDatabase.createAccountSession({
      accountId,
      token,
      expireAt: Date.now() + 60_000
    })
    const session = await knexDatabase('sessions')
      .where('token', token)
      .first<{ id: string }>('id')
    return seedOAuthTokensForSession(knexDatabase, {
      accountId,
      sessionId: session.id,
      suffix: crypto.randomUUID().slice(0, 8)
    })
  }

  const getTokenSessionIds = async (accessId: string, refreshId: string) => {
    const access = await knexDatabase('oauthAccessToken')
      .where('id', accessId)
      .first()
    const refresh = await knexDatabase('oauthRefreshToken')
      .where('id', refreshId)
      .first()
    return {
      access: access?.sessionId,
      refresh: refresh?.sessionId
    }
  }

  beforeEach(async () => {
    knexDatabase = createForeignKeyEnforcingDatabase()
    sqlDatabase = getSQLDatabase(knexDatabase)
    await sqlDatabase.migrate()

    const [{ foreign_keys: fkEnabled }] = await knexDatabase.raw(
      'PRAGMA foreign_keys'
    )
    // Guard against a vacuous test: without enforcement the old bare
    // delete would pass too.
    expect(fkEnabled).toBe(1)
  })

  afterEach(async () => {
    await knexDatabase.destroy()
  })

  it('revokes a session that minted OAuth tokens without violating the foreign key', async () => {
    const { accountId } = await createAccount('revoke')
    const token = `revoke-token-${crypto.randomUUID()}`
    const { accessId, refreshId } = await createSessionWithOAuthTokens(
      accountId,
      token
    )

    const session = await knexDatabase('sessions')
      .where('token', token)
      .first<{ id: string }>('id')

    // The bug: this threw with PostgreSQL FK error 23503 before the fix.
    await expect(
      sqlDatabase.deleteAccountSessionById({ accountId, id: session.id })
    ).resolves.toBe(1)

    expect(await sqlDatabase.getAccountAllSessions({ accountId })).toHaveLength(
      0
    )
    // The tokens survive, detached from the now-deleted session, so the
    // connected app keeps working.
    const access = await knexDatabase('oauthAccessToken')
      .where('id', accessId)
      .first()
    const refresh = await knexDatabase('oauthRefreshToken')
      .where('id', refreshId)
      .first()
    expect(access?.sessionId).toBeNull()
    expect(refresh?.sessionId).toBeNull()
  })

  it('revokes other sessions that minted OAuth tokens and keeps the current one', async () => {
    const { accountId } = await createAccount('revoke-all')

    const keepToken = `keep-${crypto.randomUUID()}`
    const revokeToken = `revoke-${crypto.randomUUID()}`
    await sqlDatabase.createAccountSession({
      accountId,
      token: keepToken,
      expireAt: Date.now() + 60_000
    })
    const { accessId, refreshId } = await createSessionWithOAuthTokens(
      accountId,
      revokeToken
    )

    const count = await sqlDatabase.deleteOtherAccountSessions({
      accountId,
      exceptToken: keepToken
    })
    expect(count).toBe(1)

    const remaining = await sqlDatabase.getAccountAllSessions({
      accountId
    })
    expect(remaining.map((item) => item.token)).toEqual([keepToken])
    const access = await knexDatabase('oauthAccessToken')
      .where('id', accessId)
      .first()
    const refresh = await knexDatabase('oauthRefreshToken')
      .where('id', refreshId)
      .first()
    expect(access?.sessionId).toBeNull()
    expect(refresh?.sessionId).toBeNull()
  })

  it('changePassword wipes sessions that minted OAuth tokens without violating the foreign key', async () => {
    const { accountId } = await createAccount('change-pw')
    const { accessId, refreshId } = await createSessionWithOAuthTokens(
      accountId,
      `change-pw-${crypto.randomUUID()}`
    )

    // Changing a password wipes every session for the account; before the
    // fix this 500'd on the sessionId FK for accounts with connected apps.
    await expect(
      sqlDatabase.changePassword({
        accountId,
        newPasswordHash: 'changed_password_hash'
      })
    ).resolves.toBeUndefined()

    expect(await sqlDatabase.getAccountAllSessions({ accountId })).toHaveLength(
      0
    )
    expect(await getTokenSessionIds(accessId, refreshId)).toEqual({
      access: null,
      refresh: null
    })
  })

  it('resetPasswordWithCode wipes sessions that minted OAuth tokens without violating the foreign key', async () => {
    const { accountId, email } = await createAccount('reset-pw')
    const { accessId, refreshId } = await createSessionWithOAuthTokens(
      accountId,
      `reset-pw-${crypto.randomUUID()}`
    )

    const passwordResetCode = `reset-${crypto.randomUUID()}`
    await sqlDatabase.requestPasswordReset({ email, passwordResetCode })

    await expect(
      sqlDatabase.resetPasswordWithCode({
        passwordResetCode,
        newPasswordHash: 'reset_password_hash'
      })
    ).resolves.toMatchObject({ id: accountId })

    expect(await sqlDatabase.getAccountAllSessions({ accountId })).toHaveLength(
      0
    )
    expect(await getTokenSessionIds(accessId, refreshId)).toEqual({
      access: null,
      refresh: null
    })
  })

  it('revokes more sessions than the bind-parameter chunk size in one call', async () => {
    const { accountId } = await createAccount('bulk')

    const keepToken = `keep-${crypto.randomUUID()}`
    await sqlDatabase.createAccountSession({
      accountId,
      token: keepToken,
      expireAt: Date.now() + 60_000
    })

    // Insert more revocable sessions than one chunk holds so the delete
    // (and the token detach) must span at least two `whereIn` batches.
    const now = new Date()
    const revokeCount = SESSION_ID_CHUNK_SIZE + 5
    const sessionRows = Array.from({ length: revokeCount }, (_, index) => ({
      id: `bulk-sid-${index}`,
      accountId,
      token: `bulk-token-${index}`,
      expireAt: new Date(Date.now() + 60_000),
      createdAt: now,
      updatedAt: now
    }))
    // Batch the seed insert itself (SQLite caps a compound INSERT at 500
    // rows) — which is the same class of limit the production chunking
    // guards against.
    await knexDatabase.batchInsert('sessions', sessionRows, 100)

    // Put OAuth tokens on sessions in both chunks (first, mid, last) so the
    // detach has to reach across batches too.
    const tokenSessionIndexes = [0, SESSION_ID_CHUNK_SIZE, revokeCount - 1]
    const seeded = []
    for (const index of tokenSessionIndexes) {
      seeded.push(
        await seedOAuthTokensForSession(knexDatabase, {
          accountId,
          sessionId: `bulk-sid-${index}`,
          suffix: `bulk-${index}`
        })
      )
    }

    const count = await sqlDatabase.deleteOtherAccountSessions({
      accountId,
      exceptToken: keepToken
    })
    expect(count).toBe(revokeCount)

    const remaining = await sqlDatabase.getAccountAllSessions({
      accountId
    })
    expect(remaining.map((item) => item.token)).toEqual([keepToken])
    for (const { accessId, refreshId } of seeded) {
      expect(await getTokenSessionIds(accessId, refreshId)).toEqual({
        access: null,
        refresh: null
      })
    }
  })
})

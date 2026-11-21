import crypto from 'crypto'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

// Account recovery (password reset / password change / email change) against a
// real database, on whichever backend `TEST_DATABASE_TYPE` selects. The
// revocation is a multi-table delete inside a transaction, so a mocked
// database cannot prove it: these tests read the token tables back.
describe('account recovery', () => {
  const { database, db, prepare, captureQueries } =
    getTestDatabaseWithInstance(true)

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  const createAccount = async (prefix: string) => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const email = `${prefix}-${suffix}@${TEST_DOMAIN}`
    const accountId = await database.createAccount({
      email,
      username: `${prefix}-${suffix}`,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `private-${prefix}-${suffix}`,
      publicKey: `public-${prefix}-${suffix}`
    })
    const actors = await database.getActorsForAccount({ accountId })
    return { accountId, email, actorId: actors[0].id }
  }

  // A second actor on the same account, inserted directly: the public
  // interface only creates the first one.
  const addActor = async (accountId: string, prefix: string) => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const actorId = `https://${TEST_DOMAIN}/users/${prefix}-${suffix}`
    await db
      .insertInto('actors')
      .values({
        id: actorId,
        username: `${prefix}-${suffix}`,
        accountId,
        domain: TEST_DOMAIN
      })
      .execute()
    return actorId
  }

  const ensureClient = async (clientId: string) => {
    await db
      .insertInto('oauthClient')
      .values({
        id: crypto.randomUUID(),
        clientId,
        redirectUris: '[]'
      })
      .onConflict((conflict) => conflict.column('clientId').doNothing())
      .execute()
  }

  // A delegated access + refresh pair, as an authorized app leaves behind.
  const seedDelegatedTokens = async ({
    accountId,
    actorId,
    clientId,
    suffix
  }: {
    accountId: string
    actorId: string
    clientId: string
    suffix: string
  }) => {
    await ensureClient(clientId)
    const refreshId = `refresh-${suffix}`
    await db
      .insertInto('oauthRefreshToken')
      .values({
        id: refreshId,
        token: `refresh-token-${suffix}`,
        clientId,
        userId: accountId,
        referenceId: actorId,
        scopes: 'read',
        expiresAt: new Date(Date.now() + 86_400_000)
      })
      .execute()
    await db
      .insertInto('oauthAccessToken')
      .values({
        id: `access-${suffix}`,
        token: `access-token-${suffix}`,
        clientId,
        userId: accountId,
        referenceId: actorId,
        refreshId,
        scopes: 'read',
        expiresAt: new Date(Date.now() + 3_600_000)
      })
      .execute()
  }

  // A client-credentials token: no user, no actor, no refresh token.
  const seedAppOnlyToken = async (clientId: string, suffix: string) => {
    await ensureClient(clientId)
    await db
      .insertInto('oauthAccessToken')
      .values({
        id: `app-access-${suffix}`,
        token: `app-access-token-${suffix}`,
        clientId,
        userId: null,
        referenceId: null,
        scopes: 'read',
        expiresAt: new Date(Date.now() + 3_600_000)
      })
      .execute()
  }

  // A consent row, as approving an app leaves behind.
  const seedConsent = async ({
    accountId,
    actorId,
    clientId,
    suffix
  }: {
    accountId: string
    actorId: string | null
    clientId: string
    suffix: string
  }) => {
    await ensureClient(clientId)
    await db
      .insertInto('oauthConsent')
      .values({
        id: `consent-${suffix}`,
        clientId,
        userId: accountId,
        referenceId: actorId,
        scopes: 'read'
      })
      .execute()
  }

  const consentIds = async (userId: string) =>
    (
      await db
        .selectFrom('oauthConsent')
        .select('id')
        .where('userId', '=', userId)
        .execute()
    )
      .map((row) => row.id)
      .sort()

  const tokenIds = async (where: {
    userId?: string | null
    referenceId?: string | null
  }) => {
    let access = db.selectFrom('oauthAccessToken').select('id')
    let refresh = db.selectFrom('oauthRefreshToken').select('id')
    if (where.userId !== undefined) {
      access =
        where.userId === null
          ? access.where('userId', 'is', null)
          : access.where('userId', '=', where.userId)
      refresh =
        where.userId === null
          ? refresh.where('userId', 'is', null)
          : refresh.where('userId', '=', where.userId)
    }
    if (where.referenceId !== undefined) {
      access =
        where.referenceId === null
          ? access.where('referenceId', 'is', null)
          : access.where('referenceId', '=', where.referenceId)
      refresh =
        where.referenceId === null
          ? refresh.where('referenceId', 'is', null)
          : refresh.where('referenceId', '=', where.referenceId)
    }
    return {
      access: (await access.execute()).map((row) => row.id).sort(),
      refresh: (await refresh.execute()).map((row) => row.id).sort()
    }
  }

  const requestReset = async (email: string) => {
    const passwordResetCode = `reset-${crypto.randomUUID()}`
    expect(
      await database.requestPasswordReset({ email, passwordResetCode })
    ).toBeTrue()
    return passwordResetCode
  }

  describe('resetPasswordWithCode', () => {
    it("revokes every actor's access and refresh tokens, leaving other accounts and app-only tokens", async () => {
      const target = await createAccount('reset-target')
      const secondActorId = await addActor(target.accountId, 'reset-second')
      const other = await createAccount('reset-other')

      await seedDelegatedTokens({
        accountId: target.accountId,
        actorId: target.actorId,
        clientId: 'reset-client',
        suffix: 'reset-first'
      })
      await seedDelegatedTokens({
        accountId: target.accountId,
        actorId: secondActorId,
        clientId: 'reset-client',
        suffix: 'reset-second'
      })
      await seedDelegatedTokens({
        accountId: other.accountId,
        actorId: other.actorId,
        clientId: 'reset-client',
        suffix: 'reset-other'
      })
      await seedAppOnlyToken('reset-app-client', 'reset-app')
      await seedConsent({
        accountId: target.accountId,
        actorId: target.actorId,
        clientId: 'reset-client',
        suffix: 'reset-first'
      })
      await seedConsent({
        accountId: target.accountId,
        actorId: secondActorId,
        clientId: 'reset-client',
        suffix: 'reset-second'
      })
      await seedConsent({
        accountId: other.accountId,
        actorId: other.actorId,
        clientId: 'reset-client',
        suffix: 'reset-other'
      })

      const passwordResetCode = await requestReset(target.email)
      const reset = await database.resetPasswordWithCode({
        passwordResetCode,
        newPasswordHash: 'reset-hash'
      })
      expect(reset).toMatchObject({ id: target.accountId })

      expect(await tokenIds({ userId: target.accountId })).toEqual({
        access: [],
        refresh: []
      })
      // The consent rows go too: a surviving consent would let the client skip
      // the prompt and mint a fresh code after the reset.
      expect(await consentIds(target.accountId)).toEqual([])
      // Another account's consent survives.
      expect(await consentIds(other.accountId)).toEqual(['consent-reset-other'])
      // The second actor's tokens are keyed by the same account, so the
      // account arm alone would cover them; assert the actor arm too by
      // checking nothing is left under either actor.
      expect(await tokenIds({ referenceId: secondActorId })).toEqual({
        access: [],
        refresh: []
      })

      // Another account's delegated tokens survive.
      expect(await tokenIds({ userId: other.accountId })).toEqual({
        access: ['access-reset-other'],
        refresh: ['refresh-reset-other']
      })
      // The app-only token has no user and no actor, so it survives.
      expect(await tokenIds({ userId: null })).toEqual({
        access: ['app-access-reset-app'],
        refresh: []
      })
    })

    it('clears a pending email change', async () => {
      const target = await createAccount('reset-email')
      await database.requestEmailChange({
        accountId: target.accountId,
        newEmail: `pending-${crypto.randomUUID()}@${TEST_DOMAIN}`,
        emailChangeCode: 'pending-email-code',
        expectedPasswordHash: TEST_PASSWORD_HASH
      })
      expect(
        await database.getAccountFromId({ id: target.accountId })
      ).toMatchObject({ emailChangeCode: 'pending-email-code' })

      const passwordResetCode = await requestReset(target.email)
      await database.resetPasswordWithCode({
        passwordResetCode,
        newPasswordHash: 'reset-hash'
      })

      expect(
        await database.getAccountFromId({ id: target.accountId })
      ).toMatchObject({
        emailChangePending: null,
        emailChangeCode: null,
        emailChangeCodeExpiresAt: null
      })
    })

    it('deletes the sessions before sweeping the tokens', async () => {
      const target = await createAccount('reset-order')
      await database.createAccountSession({
        accountId: target.accountId,
        token: `reset-order-session-${crypto.randomUUID()}`,
        expireAt: Date.now() + 60_000
      })
      await seedDelegatedTokens({
        accountId: target.accountId,
        actorId: target.actorId,
        clientId: 'reset-client',
        suffix: 'reset-order'
      })
      const passwordResetCode = await requestReset(target.email)

      const statements = await captureQueries(() =>
        database.resetPasswordWithCode({
          passwordResetCode,
          newPasswordHash: 'reset-hash'
        })
      )
      const sessionDelete = statements.findIndex((statement) =>
        /delete\s+from\s+"?sessions"?/i.test(statement.sql)
      )
      const tokenDelete = statements.findIndex((statement) =>
        /delete\s+from\s+"?oauthAccessToken"?/i.test(statement.sql)
      )
      expect(sessionDelete).toBeGreaterThanOrEqual(0)
      expect(tokenDelete).toBeGreaterThanOrEqual(0)
      // A concurrent exchange can only mint a token bound to a session that
      // still exists, so the sessions must go first.
      expect(sessionDelete).toBeLessThan(tokenDelete)
    })
  })

  describe('changePassword', () => {
    it('revokes the account tokens when signOutApps is true', async () => {
      const target = await createAccount('change-revoke')
      await seedDelegatedTokens({
        accountId: target.accountId,
        actorId: target.actorId,
        clientId: 'change-client',
        suffix: 'change-revoke'
      })

      await database.changePassword({
        accountId: target.accountId,
        newPasswordHash: 'changed-hash',
        signOutApps: true,
        expectedPasswordHash: TEST_PASSWORD_HASH
      })

      expect(await tokenIds({ userId: target.accountId })).toEqual({
        access: [],
        refresh: []
      })
    })

    it('keeps the account tokens when signOutApps is false', async () => {
      const target = await createAccount('change-keep')
      await seedDelegatedTokens({
        accountId: target.accountId,
        actorId: target.actorId,
        clientId: 'change-client',
        suffix: 'change-keep'
      })

      await database.changePassword({
        accountId: target.accountId,
        newPasswordHash: 'changed-hash',
        signOutApps: false,
        expectedPasswordHash: TEST_PASSWORD_HASH
      })

      expect(await tokenIds({ userId: target.accountId })).toEqual({
        access: ['access-change-keep'],
        refresh: ['refresh-change-keep']
      })
    })

    it('clears a pending email change', async () => {
      const target = await createAccount('change-email')
      await database.requestEmailChange({
        accountId: target.accountId,
        newEmail: `pending-${crypto.randomUUID()}@${TEST_DOMAIN}`,
        emailChangeCode: 'pending-email-code',
        expectedPasswordHash: TEST_PASSWORD_HASH
      })

      await database.changePassword({
        accountId: target.accountId,
        newPasswordHash: 'changed-hash',
        signOutApps: false,
        expectedPasswordHash: TEST_PASSWORD_HASH
      })

      expect(
        await database.getAccountFromId({ id: target.accountId })
      ).toMatchObject({
        emailChangePending: null,
        emailChangeCode: null,
        emailChangeCodeExpiresAt: null
      })
    })

    it('does not change the password when the verified hash no longer matches', async () => {
      const target = await createAccount('change-stale')

      const changed = await database.changePassword({
        accountId: target.accountId,
        newPasswordHash: 'changed-hash',
        signOutApps: false,
        expectedPasswordHash: 'a-different-hash'
      })

      expect(changed).toBeFalse()
      expect(
        await database.getAccountFromId({ id: target.accountId })
      ).toMatchObject({ passwordHash: TEST_PASSWORD_HASH })
    })
  })

  describe('requestEmailChange', () => {
    it('does not store a pending change when the verified hash no longer matches', async () => {
      const target = await createAccount('email-stale')

      const saved = await database.requestEmailChange({
        accountId: target.accountId,
        newEmail: `stale-${crypto.randomUUID()}@${TEST_DOMAIN}`,
        emailChangeCode: 'stale-code',
        expectedPasswordHash: 'a-different-hash'
      })

      expect(saved).toBeFalse()
      expect(
        await database.getAccountFromId({ id: target.accountId })
      ).toMatchObject({ emailChangePending: null, emailChangeCode: null })
    })
  })

  describe('requestPasswordReset', () => {
    it('binds the reset code to the address it looked up', async () => {
      const target = await createAccount('reset-race')

      const statements = await captureQueries(() =>
        database.requestPasswordReset({
          email: target.email,
          passwordResetCode: 'race-code'
        })
      )
      const update = statements.find(
        (statement) =>
          /update\s+"?accounts"?/i.test(statement.sql) &&
          /passwordResetCode/i.test(statement.sql)
      )
      expect(update).toBeDefined()
      // The write matches the address too, so a concurrent email change
      // between the lookup and the write cannot leave a usable code behind.
      expect(update?.sql).toMatch(/"email"\s*=/)
    })
  })

  describe('verifyEmailChange', () => {
    it('promotes the pending address and clears the pending password reset', async () => {
      const target = await createAccount('verify-ok')
      const newEmail = `moved-${crypto.randomUUID()}@${TEST_DOMAIN}`
      await database.requestEmailChange({
        accountId: target.accountId,
        newEmail,
        emailChangeCode: 'verify-code',
        expectedPasswordHash: TEST_PASSWORD_HASH
      })
      await requestReset(target.email)

      const verified = await database.verifyEmailChange({
        accountId: target.accountId,
        emailChangeCode: 'verify-code'
      })

      expect(verified).toMatchObject({ id: target.accountId, email: newEmail })
      expect(
        await database.getAccountFromId({ id: target.accountId })
      ).toMatchObject({
        email: newEmail,
        emailChangePending: null,
        emailChangeCode: null,
        passwordResetCode: null,
        passwordResetCodeExpiresAt: null
      })
    })

    it('rejects a code that a newer request replaced', async () => {
      const target = await createAccount('verify-stale')
      await database.requestEmailChange({
        accountId: target.accountId,
        newEmail: `first-${crypto.randomUUID()}@${TEST_DOMAIN}`,
        emailChangeCode: 'first-code',
        expectedPasswordHash: TEST_PASSWORD_HASH
      })
      const secondEmail = `second-${crypto.randomUUID()}@${TEST_DOMAIN}`
      await database.requestEmailChange({
        accountId: target.accountId,
        newEmail: secondEmail,
        emailChangeCode: 'second-code',
        expectedPasswordHash: TEST_PASSWORD_HASH
      })

      expect(
        await database.verifyEmailChange({
          accountId: target.accountId,
          emailChangeCode: 'first-code'
        })
      ).toBeNull()
      // The stale attempt changed nothing.
      expect(
        await database.getAccountFromId({ id: target.accountId })
      ).toMatchObject({ email: target.email, emailChangeCode: 'second-code' })

      expect(
        await database.verifyEmailChange({
          accountId: target.accountId,
          emailChangeCode: 'second-code'
        })
      ).toMatchObject({ email: secondEmail })
    })

    it('rejects an expired code', async () => {
      const target = await createAccount('verify-expired')
      await database.requestEmailChange({
        accountId: target.accountId,
        newEmail: `expired-${crypto.randomUUID()}@${TEST_DOMAIN}`,
        emailChangeCode: 'expired-code',
        expectedPasswordHash: TEST_PASSWORD_HASH
      })
      // Push the expiry into the past directly; the public interface always
      // writes a future one.
      await db
        .updateTable('accounts')
        .set({ emailChangeCodeExpiresAt: new Date(Date.now() - 1_000) })
        .where('id', '=', target.accountId)
        .execute()

      expect(
        await database.verifyEmailChange({
          accountId: target.accountId,
          emailChangeCode: 'expired-code'
        })
      ).toBeNull()
      expect(
        await database.getAccountFromId({ id: target.accountId })
      ).toMatchObject({ email: target.email })
    })
  })
})

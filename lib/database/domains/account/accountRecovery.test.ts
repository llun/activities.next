import crypto from 'crypto'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

// Account recovery (password reset / password change / email change) against a
// real database, on whichever backend `TEST_DATABASE_TYPE` selects. The
// revocation is a multi-table delete inside a transaction, so a mocked
// database cannot prove it: these tests read the token tables back.
describe('account recovery', () => {
  const { database, db, prepare } = getTestDatabaseWithInstance(true)

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
        emailChangeCode: 'pending-email-code'
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
        signOutApps: true
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
        signOutApps: false
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
        emailChangeCode: 'pending-email-code'
      })

      await database.changePassword({
        accountId: target.accountId,
        newPasswordHash: 'changed-hash',
        signOutApps: false
      })

      expect(
        await database.getAccountFromId({ id: target.accountId })
      ).toMatchObject({
        emailChangePending: null,
        emailChangeCode: null,
        emailChangeCodeExpiresAt: null
      })
    })
  })

  describe('verifyEmailChange', () => {
    it('promotes the pending address and clears the pending password reset', async () => {
      const target = await createAccount('verify-ok')
      const newEmail = `moved-${crypto.randomUUID()}@${TEST_DOMAIN}`
      await database.requestEmailChange({
        accountId: target.accountId,
        newEmail,
        emailChangeCode: 'verify-code'
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
        emailChangeCode: 'first-code'
      })
      const secondEmail = `second-${crypto.randomUUID()}@${TEST_DOMAIN}`
      await database.requestEmailChange({
        accountId: target.accountId,
        newEmail: secondEmail,
        emailChangeCode: 'second-code'
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
        emailChangeCode: 'expired-code'
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

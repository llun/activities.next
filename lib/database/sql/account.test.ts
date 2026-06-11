import crypto from 'crypto'
import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import {
  TestDatabaseTable,
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  TEST_DOMAIN,
  TEST_EMAIL2,
  TEST_PASSWORD_HASH,
  TEST_USERNAME2
} from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { logger } from '@/lib/utils/logger'
import { urlToId } from '@/lib/utils/urlToId'

describe('AccountDatabase', () => {
  const { actors } = DatabaseSeed
  const table: TestDatabaseTable = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    const createTestAccount = async ({
      verificationCode
    }: { verificationCode?: string } = {}) => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `user-${suffix}`
      const email = `${username}@${TEST_DOMAIN}`
      const accountId = await database.createAccount({
        email,
        username,
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: `privateKey-${suffix}`,
        publicKey: `publicKey-${suffix}`,
        verificationCode
      })

      return { accountId, username, email }
    }

    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    it('returns false when account is not created yet', async () => {
      expect(await database.isAccountExists({ email: TEST_EMAIL2 })).toBeFalse()
      expect(
        await database.isUsernameExists({
          username: TEST_USERNAME2,
          domain: TEST_DOMAIN
        })
      ).toBeFalse()
    })

    it('creates account and actor', async () => {
      await database.createAccount({
        email: TEST_EMAIL2,
        username: TEST_USERNAME2,
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: 'privateKey2',
        publicKey: 'publicKey2'
      })
      const actor = await database.getMastodonActorFromUsername({
        username: TEST_USERNAME2,
        domain: TEST_DOMAIN
      })

      expect(await database.isAccountExists({ email: TEST_EMAIL2 })).toBeTrue()
      expect(
        await database.isUsernameExists({
          username: TEST_USERNAME2,
          domain: TEST_DOMAIN
        })
      ).toBeTrue()
      expect(actor).toMatchObject({
        id: urlToId(`https://${TEST_DOMAIN}/users/${TEST_USERNAME2}`),
        username: TEST_USERNAME2,
        acct: TEST_USERNAME2,
        url: `https://${TEST_DOMAIN}/users/${TEST_USERNAME2}`,
        display_name: '',
        note: '',
        avatar: '',
        avatar_static: '',
        header: '',
        header_static: '',
        locked: true,
        fields: [],
        emojis: [],
        bot: false,
        group: false,
        discoverable: true,
        noindex: false,
        created_at: expect.toBeString(),
        last_status_at: null,
        statuses_count: 0,
        followers_count: 0,
        following_count: 0
      })
    })

    it('returns actor from getActor methods', async () => {
      const actor = await database.getActorFromEmail({ email: TEST_EMAIL2 })
      expect(actor).toMatchObject({
        id: expect.toBeString(),
        username: TEST_USERNAME2,
        domain: TEST_DOMAIN,
        account: {
          id: expect.toBeString(),
          email: TEST_EMAIL2
        },
        followersUrl: expect.toBeString(),
        publicKey: expect.toBeString(),
        privateKey: expect.toBeString()
      })
    })

    it('returns actor from getMastodonActor methods', async () => {
      const actor = await database.getMastodonActorFromId({
        id: actors.primary.id
      })
      expect(actor).toMatchObject({
        id: urlToId(actors.primary.id),
        username: actors.primary.username,
        acct: `${actors.primary.username}@${actors.primary.domain}`,
        url: `https://${actors.primary.domain}/users/${actors.primary.username}`,
        display_name: '',
        note: '',
        avatar: '',
        avatar_static: '',
        header: '',
        header_static: '',
        locked: true,
        fields: [],
        emojis: [],
        bot: false
      })
    })

    describe('accounts', () => {
      it('returns account from getAccountFromId', async () => {
        const { accountId, email } = await createTestAccount()

        const account = await database.getAccountFromId({ id: accountId })
        expect(account).toMatchObject({
          id: accountId,
          email,
          verifiedAt: expect.toBeNumber()
        })
      })

      it('verifies account with verification code', async () => {
        const verificationCode = `verify-${crypto.randomUUID()}`
        const { accountId } = await createTestAccount({ verificationCode })

        const verified = await database.verifyAccount({ verificationCode })
        expect(verified).toMatchObject({
          id: accountId,
          verificationCode: '',
          verifiedAt: expect.toBeNumber()
        })

        const invalid = await database.verifyAccount({
          verificationCode: 'missing-code'
        })
        expect(invalid).toBeNull()
      })

      it('updates the account email', async () => {
        const { accountId } = await createTestAccount()
        const newEmail = `updated-${crypto.randomUUID()}@${TEST_DOMAIN}`

        await database.updateAccountEmail({ accountId, email: newEmail })

        const account = await database.getAccountFromId({ id: accountId })
        expect(account).toMatchObject({ id: accountId, email: newEmail })
      })

      it('creates and consumes password reset codes', async () => {
        const { accountId, email } = await createTestAccount()
        const passwordResetCode = `reset-${crypto.randomUUID()}`
        const token = `session-${crypto.randomUUID()}`

        await database.createAccountSession({
          accountId,
          token,
          expireAt: Date.now() + 60_000
        })

        const requested = await database.requestPasswordReset({
          email,
          passwordResetCode
        })

        expect(requested).toBeTrue()

        const accountWithResetCode = await database.getAccountFromId({
          id: accountId
        })
        expect(accountWithResetCode).toMatchObject({
          id: accountId,
          passwordResetCode,
          passwordResetCodeExpiresAt: expect.toBeNumber()
        })
        expect(
          await database.validatePasswordResetCode({ passwordResetCode })
        ).toBe(accountId)

        const resetResult = await database.resetPasswordWithCode({
          passwordResetCode,
          newPasswordHash: 'new_password_hash'
        })
        expect(resetResult).toMatchObject({
          id: accountId,
          passwordHash: 'new_password_hash',
          passwordResetCode: null,
          passwordResetCodeExpiresAt: null
        })
        expect(await database.getAccountSession({ token })).toBeNull()
        expect(
          await database.getAccountAllSessions({ accountId })
        ).toHaveLength(0)

        const reused = await database.resetPasswordWithCode({
          passwordResetCode,
          newPasswordHash: 'another_password_hash'
        })
        expect(reused).toBeNull()
      })

      it('returns false when requesting password reset for unknown email', async () => {
        const requested = await database.requestPasswordReset({
          email: `missing-${crypto.randomUUID()}@${TEST_DOMAIN}`,
          passwordResetCode: `reset-${crypto.randomUUID()}`
        })
        expect(requested).toBeFalse()
      })

      it('clears password reset code when null code is provided', async () => {
        const { accountId, email } = await createTestAccount()

        await database.requestPasswordReset({
          email,
          passwordResetCode: `reset-${crypto.randomUUID()}`
        })
        await database.requestPasswordReset({
          email,
          passwordResetCode: null,
          expiresAt: null
        })

        const account = await database.getAccountFromId({ id: accountId })
        expect(account).toMatchObject({
          id: accountId,
          passwordResetCode: null,
          passwordResetCodeExpiresAt: null
        })
      })

      it('invalidates previous password reset code when a new one is issued', async () => {
        const { accountId, email } = await createTestAccount()
        const firstCode = `reset-${crypto.randomUUID()}`
        const secondCode = `reset-${crypto.randomUUID()}`

        await database.requestPasswordReset({
          email,
          passwordResetCode: firstCode
        })
        await database.requestPasswordReset({
          email,
          passwordResetCode: secondCode
        })

        const firstAttempt = await database.resetPasswordWithCode({
          passwordResetCode: firstCode,
          newPasswordHash: 'hash_should_not_apply'
        })
        expect(firstAttempt).toBeNull()

        const secondAttempt = await database.resetPasswordWithCode({
          passwordResetCode: secondCode,
          newPasswordHash: 'hash_should_apply'
        })
        expect(secondAttempt).toMatchObject({
          id: accountId,
          passwordHash: 'hash_should_apply'
        })
      })

      it('rejects expired password reset codes', async () => {
        const { email } = await createTestAccount()
        const expiredCode = `reset-${crypto.randomUUID()}`

        await database.requestPasswordReset({
          email,
          passwordResetCode: expiredCode,
          expiresAt: Date.now() - 1_000
        })

        const accountId = await database.validatePasswordResetCode({
          passwordResetCode: expiredCode
        })
        expect(accountId).toBeNull()

        const resetResult = await database.resetPasswordWithCode({
          passwordResetCode: expiredCode,
          newPasswordHash: 'should_not_apply'
        })
        expect(resetResult).toBeNull()
      })

      it('changePassword clears reset code and invalidates sessions', async () => {
        const { accountId, email } = await createTestAccount()
        const token = `session-${crypto.randomUUID()}`
        const passwordResetCode = `reset-${crypto.randomUUID()}`

        await database.createAccountSession({
          accountId,
          token,
          expireAt: Date.now() + 60_000
        })
        await database.requestPasswordReset({
          email,
          passwordResetCode
        })

        await database.changePassword({
          accountId,
          newPasswordHash: 'updated_hash'
        })

        const account = await database.getAccountFromId({ id: accountId })
        expect(account).toMatchObject({
          id: accountId,
          passwordHash: 'updated_hash',
          passwordResetCode: null,
          passwordResetCodeExpiresAt: null
        })
        expect(await database.getAccountSession({ token })).toBeNull()
      })

      it('stores account email lowercased even when created with mixed case', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `mixed-${suffix}`
        const mixedEmail = `Mixed.${suffix}@${TEST_DOMAIN}`
        const accountId = await database.createAccount({
          email: mixedEmail,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        const account = await database.getAccountFromId({ id: accountId })
        expect(account?.email).toEqual(mixedEmail.toLowerCase())
      })

      it.each<{ description: string; casing: (email: string) => string }>([
        { description: 'the exact lowercase form', casing: (email) => email },
        {
          description: 'an uppercase form',
          casing: (email) => email.toUpperCase()
        },
        {
          description: 'a mixed-case form',
          casing: (email) =>
            email
              .split('')
              .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c))
              .join('')
        },
        {
          description: 'a form with surrounding whitespace',
          casing: (email) => `  ${email.toUpperCase()}  `
        }
      ])(
        'looks up an account case-insensitively by $description',
        async ({ casing }) => {
          const { accountId, email } = await createTestAccount()

          expect(
            await database.isAccountExists({ email: casing(email) })
          ).toBeTrue()
          const found = await database.getAccountFromEmail({
            email: casing(email)
          })
          expect(found?.id).toEqual(accountId)
        }
      )

      it('normalizes the pending email on request and promotes it lowercased on verify', async () => {
        const { accountId } = await createTestAccount()
        const suffix = crypto.randomUUID().slice(0, 8)
        const newEmail = `New.${suffix}@${TEST_DOMAIN}`
        const emailChangeCode = `change-${crypto.randomUUID()}`

        await database.requestEmailChange({
          accountId,
          newEmail,
          emailChangeCode
        })

        const pending = await database.getAccountFromId({ id: accountId })
        expect(pending?.emailChangePending).toEqual(newEmail.toLowerCase())

        const updated = await database.verifyEmailChange({
          accountId,
          emailChangeCode
        })
        expect(updated?.email).toEqual(newEmail.toLowerCase())
        // The promoted address is now resolvable regardless of casing.
        const found = await database.getAccountFromEmail({
          email: newEmail.toUpperCase()
        })
        expect(found?.id).toEqual(accountId)
      })

      it('stores a lowercased email when updateAccountEmail is given mixed case', async () => {
        const { accountId } = await createTestAccount()
        const suffix = crypto.randomUUID().slice(0, 8)
        const newEmail = `Updated.${suffix}@${TEST_DOMAIN}`

        await database.updateAccountEmail({ accountId, email: newEmail })

        const account = await database.getAccountFromId({ id: accountId })
        expect(account?.email).toEqual(newEmail.toLowerCase())
      })

      it('finds the account for a password reset regardless of the requested casing', async () => {
        const { accountId, email } = await createTestAccount()
        const passwordResetCode = `reset-${crypto.randomUUID()}`

        const requested = await database.requestPasswordReset({
          email: email.toUpperCase(),
          passwordResetCode
        })

        expect(requested).toBeTrue()
        expect(
          await database.validatePasswordResetCode({ passwordResetCode })
        ).toBe(accountId)
      })
    })

    describe('account providers', () => {
      it('links, resolves, and unlinks account providers', async () => {
        const { accountId } = await createTestAccount()
        const provider = 'external'
        const providerAccountId = `external-${crypto.randomUUID()}`

        const linked = await database.linkAccountWithProvider({
          accountId,
          provider,
          providerAccountId
        })
        expect(linked?.id).toBe(accountId)

        const resolved = await database.getAccountFromProviderId({
          provider,
          accountId: providerAccountId
        })
        expect(resolved?.id).toBe(accountId)

        const providers = await database.getAccountProviders({ accountId })
        expect(providers).toHaveLength(2)
        expect(providers).toContainEqual(
          expect.objectContaining({
            provider: 'credential',
            providerId: accountId
          })
        )
        expect(providers).toContainEqual(
          expect.objectContaining({
            provider,
            providerId: providerAccountId
          })
        )

        await database.unlinkAccountFromProvider({ accountId, provider })
        const afterUnlink = await database.getAccountProviders({ accountId })
        expect(afterUnlink).toHaveLength(1)
        expect(afterUnlink).not.toContainEqual(
          expect.objectContaining({
            provider,
            providerId: providerAccountId
          })
        )
      })
    })

    describe('account sessions', () => {
      it('creates, updates, and deletes account sessions', async () => {
        const { accountId } = await createTestAccount()
        const token = `token-${crypto.randomUUID()}`
        const expireAt = Date.now() + 60_000

        await database.createAccountSession({ accountId, token, expireAt })

        const sessionResult = await database.getAccountSession({ token })
        expect(sessionResult).toMatchObject({
          account: { id: accountId },
          session: { token, accountId, expireAt }
        })

        const sessions = await database.getAccountAllSessions({ accountId })
        expect(sessions).toHaveLength(1)
        expect(sessions[0]).toMatchObject({ token, expireAt })

        const updatedExpireAt = Date.now() + 120_000
        await database.updateAccountSession({
          token,
          expireAt: updatedExpireAt
        })
        const updated = await database.getAccountSession({ token })
        expect(updated?.session.expireAt).toBe(updatedExpireAt)

        await database.deleteAccountSession({ token })
        const deleted = await database.getAccountSession({ token })
        expect(deleted).toBeNull()
      })

      it('records login counters once per account per UTC week', async () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)

        const getLoginTotal = async () => {
          const row = await knexDatabase('counters')
            .where('id', 'like', 'bucket:logins:%')
            .sum<{ total: number | string | null }>('value as total')
            .first()
          return Number(row?.total ?? 0)
        }

        try {
          await sqlDatabase.migrate()

          jest.useFakeTimers()
          jest.setSystemTime(new Date('2026-01-08T10:00:00.000Z'))

          const accountId = await sqlDatabase.createAccount({
            email: `login-${crypto.randomUUID()}@${TEST_DOMAIN}`,
            username: `login-${crypto.randomUUID().slice(0, 8)}`,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: 'private-login-key',
            publicKey: 'public-login-key'
          })

          await sqlDatabase.createAccountSession({
            accountId,
            token: 'login-week-one-a',
            expireAt: Date.now() + 60_000
          })
          await sqlDatabase.createAccountSession({
            accountId,
            token: 'login-week-one-b',
            expireAt: Date.now() + 120_000
          })

          jest.setSystemTime(new Date('2026-01-13T10:00:00.000Z'))
          await sqlDatabase.createAccountSession({
            accountId,
            token: 'login-week-two',
            expireAt: Date.now() + 60_000
          })

          const markerRows = await knexDatabase('counters')
            .where('id', `unique-login:${accountId}`)
            .orderBy('id', 'asc')
            .select('id', 'value')

          expect(await getLoginTotal()).toBe(2)
          expect(markerRows).toEqual([
            {
              id: `unique-login:${accountId}`,
              value: Math.floor(Date.UTC(2026, 0, 12) / 1000)
            }
          ])
        } finally {
          jest.useRealTimers()
          await knexDatabase.destroy()
        }
      })

      it('creates account sessions when login counter recording fails', async () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)
        const errorSpy = jest
          .spyOn(logger, 'error')
          .mockImplementation(() => undefined)

        try {
          await sqlDatabase.migrate()

          const accountId = await sqlDatabase.createAccount({
            email: `login-failure-${crypto.randomUUID()}@${TEST_DOMAIN}`,
            username: `login-failure-${crypto.randomUUID().slice(0, 8)}`,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: 'private-login-failure-key',
            publicKey: 'public-login-failure-key'
          })

          await knexDatabase.schema.dropTable('counters')

          await expect(
            sqlDatabase.createAccountSession({
              accountId,
              token: 'login-counter-failure',
              expireAt: Date.now() + 60_000
            })
          ).resolves.toBeUndefined()

          const session = await knexDatabase('sessions')
            .where('token', 'login-counter-failure')
            .first()

          expect(session).toMatchObject({ accountId })
        } finally {
          await new Promise((resolve) => setImmediate(resolve))
          errorSpy.mockRestore()
          await knexDatabase.destroy()
        }
      })
    })
  })
})

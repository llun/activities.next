import crypto from 'crypto'

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
        acct: `${TEST_USERNAME2}@${TEST_DOMAIN}`,
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
    })

    describe('account providers', () => {
      it('links, resolves, and unlinks account providers', async () => {
        const { accountId } = await createTestAccount()
        const provider = 'github'
        const providerAccountId = `gh-${crypto.randomUUID()}`

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
        expect(providers).toHaveLength(1)
        expect(providers[0]).toMatchObject({
          provider,
          providerId: providerAccountId
        })

        await database.unlinkAccountFromProvider({ accountId, provider })
        const afterUnlink = await database.getAccountProviders({ accountId })
        expect(afterUnlink).toHaveLength(0)
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
    })
  })
})

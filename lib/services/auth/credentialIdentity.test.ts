import bcrypt from 'bcrypt'

import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { registerAccount } from '@/lib/services/accounts/registerAccount'
import { getAuth } from '@/lib/services/auth/auth'

// Better Auth 1.7.3 identifies an account by the provider pair
// `(providerId, accountId)`. The old issuer column is retained only for the
// historical migration and may be NULL or contain a legacy value indefinitely.
const HOST = 'test.example.com'
const BASE_URL = `https://${HOST}`
const PASSWORD = 'testpassword123'
const NEW_PASSWORD = 'newtestpassword456'
// The lowest cost bcrypt accepts: fixtures only need a valid hash, and
// bcrypt.compare reads the cost from it (production hashes at 10).
const TEST_BCRYPT_COST = 4

const holder = vi.hoisted(() => ({
  testDb: null as TestDatabase | null
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: HOST,
    serviceName: 'Activities.next Test',
    secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
    trustedHosts: [],
    auth: { enableCredential: true }
  }),
  getBaseURL: () => BASE_URL
}))

vi.mock('@/lib/database', () => ({
  getKysely: () => holder.testDb?.db,
  getDatabase: () => holder.testDb?.database ?? null
}))

vi.mock('@/lib/services/serverSettings', () => {
  const settings = {
    instance: { name: 'activities.next' },
    registrations: { open: true, allowEmails: [] },
    // No terms or privacy policy, so sign-up asks for no agreement.
    policies: { termsOfService: '', privacyPolicy: '' }
  }
  return {
    getResolvedServerSettings: vi.fn().mockResolvedValue(settings),
    getServerSettingsView: vi
      .fn()
      .mockResolvedValue({ settings, locks: {}, updatedAt: {} })
  }
})

// Registration hashes at cost 10 on the libuv threadpool every worker thread
// shares; that is not what these tests check, and a cost-4 hash (compare
// reads the cost from the hash) keeps the first test inside its budget on a
// loaded runner. The key comes from the suite-wide generateKeyPair stub in
// test/setup/vitest.setup.ts.
vi.mock('@/lib/services/auth/passwordHash', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/services/auth/passwordHash')>()
  const bcrypt = (await import('bcrypt')).default
  return {
    ...actual,
    hashPassword: (password: string) => bcrypt.hash(password, 4)
  }
})

describe('credential identity', () => {
  const testDb = () => {
    if (!holder.testDb) throw new Error('The test database is not ready')
    return holder.testDb
  }
  const database = (): Database => testDb().database
  const db = () => testDb().db

  const getAuthInstance = async () => getAuth(BASE_URL)

  const signIn = async (email: string, password: string) => {
    const auth = await getAuthInstance()
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE_URL },
        body: JSON.stringify({ email, password })
      })
    )
    return response.status
  }

  const credentialRow = async (accountId: string) =>
    db()
      .selectFrom('account_providers')
      .selectAll()
      .where('accountId', '=', accountId)
      .where('provider', '=', 'credential')
      .executeTakeFirst()

  const deleteCredentialRow = async (accountId: string) => {
    await db()
      .deleteFrom('account_providers')
      .where('accountId', '=', accountId)
      .where('provider', '=', 'credential')
      .execute()
  }

  const register = async (username: string, password = PASSWORD) => {
    const email = `${username}@example.com`
    const result = await registerAccount({
      database: database(),
      username,
      email,
      password
    })
    if (result.type !== 'success') {
      throw new Error(`registration failed: ${result.type}`)
    }
    return { accountId: result.accountId, email }
  }

  const addProviderIdentity = async ({
    id,
    ownerAccountId,
    provider,
    providerAccountId
  }: {
    id: string
    ownerAccountId: string
    provider: string
    providerAccountId: string
  }) => {
    await db()
      .insertInto('account_providers')
      .values({
        id,
        // `accountId` is this application's owning user. The provider-side
        // account key is stored in `provider` + `providerId`.
        accountId: ownerAccountId,
        provider,
        providerId: providerAccountId
      })
      .execute()
  }

  const getInternalAdapter = async () => {
    const auth = await getAuthInstance()
    const context = await auth.$context
    return context.internalAdapter
  }

  beforeAll(async () => {
    const created = createTestDatabase({ isolated: true })
    await created.prepare()
    await created.database.migrate()
    holder.testDb = created
  })

  afterAll(async () => {
    await holder.testDb?.destroy()
  })

  it('lets a registered account sign in when issuer is NULL', async () => {
    const { accountId, email } = await register('null-issuer')
    const row = await credentialRow(accountId)

    expect(row).toMatchObject({
      accountId,
      provider: 'credential',
      providerId: accountId,
      issuer: null
    })
    expect(await signIn(email, PASSWORD)).toBe(200)
  })

  // The account is stored with its email lowercased, and the lookup better-auth
  // makes through the adapter matches whatever case the user types.
  it('signs in with the email typed in any case', async () => {
    const { accountId, email } = await register('mixed-case-email')
    const account = await db()
      .selectFrom('accounts')
      .select('email')
      .where('id', '=', accountId)
      .executeTakeFirst()
    expect(account?.email).toBe('mixed-case-email@example.com')

    expect(await signIn(email.toUpperCase(), PASSWORD)).toBe(200)
    expect(await signIn('Mixed-Case-Email@Example.COM', PASSWORD)).toBe(200)
  })

  it('ignores an arbitrary legacy issuer when signing in', async () => {
    const { accountId, email } = await register('legacy-issuer')
    await db()
      .updateTable('account_providers')
      .set({ issuer: 'legacy:provider:identity-that-is-no-longer-used' })
      .where('accountId', '=', accountId)
      .where('provider', '=', 'credential')
      .execute()

    expect(await signIn(email, PASSWORD)).toBe(200)
  })

  it('lets resetPasswordWithCode update an existing identity', async () => {
    const { accountId, email } = await register('reset-password')
    const passwordResetCode = 'credential-identity-reset-code'
    await database().requestPasswordReset({ email, passwordResetCode })

    await database().resetPasswordWithCode({
      passwordResetCode,
      newPasswordHash: await bcrypt.hash(NEW_PASSWORD, TEST_BCRYPT_COST)
    })

    expect(await credentialRow(accountId)).toMatchObject({
      accountId,
      provider: 'credential',
      providerId: accountId,
      issuer: null
    })
    expect(await signIn(email, NEW_PASSWORD)).toBe(200)
    expect(await signIn(email, PASSWORD)).toBe(401)
  })

  it('lets resetPasswordWithCode recreate a missing identity', async () => {
    const { accountId, email } = await register('reset-missing-provider')
    const passwordResetCode = 'credential-identity-reset-missing-code'
    await deleteCredentialRow(accountId)
    await database().requestPasswordReset({ email, passwordResetCode })

    await database().resetPasswordWithCode({
      passwordResetCode,
      newPasswordHash: await bcrypt.hash(NEW_PASSWORD, TEST_BCRYPT_COST)
    })

    expect(await credentialRow(accountId)).toMatchObject({
      accountId,
      provider: 'credential',
      providerId: accountId,
      issuer: null
    })
    expect(await signIn(email, NEW_PASSWORD)).toBe(200)
    expect(await signIn(email, PASSWORD)).toBe(401)
  })

  it('lets changePassword update an existing identity without an issuer', async () => {
    const { accountId, email } = await register('change-password')

    await database().changePassword({
      accountId,
      newPasswordHash: await bcrypt.hash(NEW_PASSWORD, TEST_BCRYPT_COST)
    })

    expect(await credentialRow(accountId)).toMatchObject({
      accountId,
      provider: 'credential',
      providerId: accountId,
      issuer: null
    })
    expect(await signIn(email, NEW_PASSWORD)).toBe(200)
    expect(await signIn(email, PASSWORD)).toBe(401)
  })

  it('lets changePassword recreate a missing identity', async () => {
    const { accountId, email } = await register('change-missing-provider')
    await deleteCredentialRow(accountId)

    await database().changePassword({
      accountId,
      newPasswordHash: await bcrypt.hash(NEW_PASSWORD, TEST_BCRYPT_COST)
    })

    expect(await credentialRow(accountId)).toMatchObject({
      accountId,
      provider: 'credential',
      providerId: accountId,
      issuer: null
    })
    expect(await signIn(email, NEW_PASSWORD)).toBe(200)
    expect(await signIn(email, PASSWORD)).toBe(401)
  })

  it('keeps equal provider-side account ids isolated by provider', async () => {
    const first = await register('provider-key-one')
    const second = await register('provider-key-two')
    const providerAccountId = 'same-provider-side-account'

    await addProviderIdentity({
      id: 'provider-key-one-link',
      ownerAccountId: first.accountId,
      provider: 'provider-one',
      providerAccountId
    })
    await addProviderIdentity({
      id: 'provider-key-two-link',
      ownerAccountId: second.accountId,
      provider: 'provider-two',
      providerAccountId
    })

    const adapter = await getInternalAdapter()
    const firstIdentity = await adapter.findAccountByKey({
      providerId: 'provider-one',
      accountId: providerAccountId
    })
    const secondIdentity = await adapter.findAccountByKey({
      providerId: 'provider-two',
      accountId: providerAccountId
    })

    expect(firstIdentity).toMatchObject({
      providerId: 'provider-one',
      accountId: providerAccountId,
      userId: first.accountId
    })
    expect(secondIdentity).toMatchObject({
      providerId: 'provider-two',
      accountId: providerAccountId,
      userId: second.accountId
    })
  })

  it('rejects an ambiguous duplicate provider identity', async () => {
    const first = await register('duplicate-provider-one')
    const second = await register('duplicate-provider-two')
    const providerAccountId = 'ambiguous-provider-side-account'

    await addProviderIdentity({
      id: 'duplicate-provider-one-link',
      ownerAccountId: first.accountId,
      provider: 'same-provider',
      providerAccountId
    })
    await addProviderIdentity({
      id: 'duplicate-provider-two-link',
      ownerAccountId: second.accountId,
      provider: 'same-provider',
      providerAccountId
    })

    const adapter = await getInternalAdapter()
    const key = { providerId: 'same-provider', accountId: providerAccountId }
    await expect(adapter.findAccountByKey(key)).rejects.toThrow(
      'Multiple accounts match the same accountId for provider'
    )
    await expect(adapter.findAccountOwnerByKey(key)).rejects.toThrow(
      'Multiple accounts match the same accountId for provider'
    )
  })
})

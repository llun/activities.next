import bcrypt from 'bcrypt'
import { Knex } from 'knex'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'

// Better Auth 1.7.3 identifies an account by the provider pair
// `(providerId, accountId)`. The old issuer column is retained only for the
// historical migration and may be NULL or contain a legacy value indefinitely.
const HOST = 'test.example.com'
const BASE_URL = `https://${HOST}`
const PASSWORD = 'testpassword123'
const NEW_PASSWORD = 'newtestpassword456'

const holder = vi.hoisted(() => ({
  knex: null as Knex | null,
  database: null as Database | null
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
  getKnex: () => holder.knex,
  getDatabase: () => holder.database
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn().mockResolvedValue({
    registrations: { open: true, allowEmails: [] }
  })
}))

describe('credential identity', () => {
  const database = () => holder.database as Database
  const db = () => holder.knex as Knex

  const getAuthInstance = async () => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    return getAuth(BASE_URL)
  }

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
    db()('account_providers')
      .where({ accountId, provider: 'credential' })
      .first()

  const register = async (username: string, password = PASSWORD) => {
    const { registerAccount } =
      await import('@/lib/services/accounts/registerAccount')
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
    await db()('account_providers').insert({
      id,
      // `accountId` is this application's owning user. The provider-side
      // account key is stored in `provider` + `providerId`.
      accountId: ownerAccountId,
      provider,
      providerId: providerAccountId
    })
  }

  const getInternalAdapter = async () => {
    const auth = await getAuthInstance()
    const context = await auth.$context
    return context.internalAdapter
  }

  beforeAll(async () => {
    const testDatabase = getTestDatabaseWithInstance(true)
    await testDatabase.prepare()
    await testDatabase.database.migrate()
    holder.knex = testDatabase.instance
    holder.database = testDatabase.database
  })

  afterAll(async () => {
    await holder.knex?.destroy()
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

  it('ignores an arbitrary legacy issuer when signing in', async () => {
    const { accountId, email } = await register('legacy-issuer')
    await db()('account_providers')
      .where('accountId', accountId)
      .where('provider', 'credential')
      .update({ issuer: 'legacy:provider:identity-that-is-no-longer-used' })

    expect(await signIn(email, PASSWORD)).toBe(200)
  })

  it('lets createCredentialProvider restore a sign-in-capable identity', async () => {
    const { accountId, email } = await register('restored-provider')
    await db()('account_providers')
      .where({ accountId, provider: 'credential' })
      .delete()

    await database().createCredentialProvider({
      accountId,
      passwordHash: await bcrypt.hash(PASSWORD, 10)
    })

    expect(await credentialRow(accountId)).toMatchObject({
      accountId,
      provider: 'credential',
      providerId: accountId,
      issuer: null
    })
    expect(await signIn(email, PASSWORD)).toBe(200)
  })

  it('ignores a duplicate createCredentialProvider password update', async () => {
    const { accountId, email } = await register('existing-provider')
    const original = await credentialRow(accountId)
    const originalPassword = original.password
    const legacyIssuer = 'legacy:provider:keep-this-value'
    await db()('account_providers')
      .where({ accountId, provider: 'credential' })
      .update({ issuer: legacyIssuer })

    await database().createCredentialProvider({
      accountId,
      passwordHash: await bcrypt.hash('different-password', 10)
    })

    const unchanged = await credentialRow(accountId)
    expect(unchanged.password).toBe(originalPassword)
    expect(unchanged.issuer).toBe(legacyIssuer)
    expect(await signIn(email, PASSWORD)).toBe(200)
  })

  it('lets resetPasswordWithCode update an existing identity', async () => {
    const { accountId, email } = await register('reset-password')
    const passwordResetCode = 'credential-identity-reset-code'
    await database().requestPasswordReset({ email, passwordResetCode })

    await database().resetPasswordWithCode({
      passwordResetCode,
      newPasswordHash: await bcrypt.hash(NEW_PASSWORD, 10)
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
    await db()('account_providers')
      .where({ accountId, provider: 'credential' })
      .delete()
    await database().requestPasswordReset({ email, passwordResetCode })

    await database().resetPasswordWithCode({
      passwordResetCode,
      newPasswordHash: await bcrypt.hash(NEW_PASSWORD, 10)
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
      newPasswordHash: await bcrypt.hash(NEW_PASSWORD, 10)
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
    await db()('account_providers')
      .where({ accountId, provider: 'credential' })
      .delete()

    await database().changePassword({
      accountId,
      newPasswordHash: await bcrypt.hash(NEW_PASSWORD, 10)
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

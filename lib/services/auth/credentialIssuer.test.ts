import bcrypt from 'bcrypt'
import knex, { Knex } from 'knex'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

// `lib/database/sql/account.ts` writes `account_providers` rows itself rather
// than through better-auth's adapter, so nothing in better-auth fills in the
// `issuer` those rows need. Since 1.7 `signInEmail` matches the credential row
// on `issuer` as well as `providerId`, and a row missing one is invisible to
// sign-in: the account exists, the password is right, and the response is still
// `INVALID_EMAIL_OR_PASSWORD`.
//
// So each of these drives a real better-auth instance against a real database
// and asserts that a credential row written by that code path can actually sign
// in — asserting the column value instead would pass just as happily against an
// issuer better-auth does not recognise.
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

const SQLITE_SCHEMA_PATH = fileURLToPath(
  new URL('../../../migrations/schema.sqlite.sql', import.meta.url)
)

const buildInMemoryKnex = async (): Promise<Knex> => {
  const instance = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const sql = readFileSync(SQLITE_SCHEMA_PATH, 'utf8')
  const connection = await instance.client.acquireConnection()
  try {
    connection.exec(sql)
  } finally {
    await instance.client.releaseConnection(connection)
  }
  return instance
}

describe('credential provider issuer', () => {
  const database = () => holder.database as Database
  const db = () => holder.knex as Knex

  const signIn = async (email: string, password: string) => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    const response = await getAuth(BASE_URL).handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE_URL },
        body: JSON.stringify({ email, password })
      })
    )
    return response.status
  }

  // Each case starts from an account whose credential row has been removed, so
  // the write under test is the INSERT branch — the one that has to supply an
  // issuer. The upsert branches merge only the password and leave an existing
  // issuer alone.
  const createAccountWithoutCredentialRow = async (username: string) => {
    const email = `${username}@example.com`
    const accountId = await database().createAccount({
      domain: HOST,
      email,
      username,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      publicKey: 'test-public-key',
      privateKey: 'test-private-key'
    })
    await db()('account_providers').where('accountId', accountId).delete()
    expect(await signIn(email, PASSWORD)).toBe(401)
    return { accountId, email }
  }

  beforeAll(async () => {
    holder.knex = await buildInMemoryKnex()
    holder.database = getSQLDatabase(holder.knex)
  })

  afterAll(async () => {
    await holder.knex?.destroy()
  })

  it('lets an account created by createAccount sign in', async () => {
    const email = 'created@example.com'
    await database().createAccount({
      domain: HOST,
      email,
      username: 'created',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      publicKey: 'test-public-key',
      privateKey: 'test-private-key'
    })

    expect(await signIn(email, PASSWORD)).toBe(200)
  })

  it('lets an account restored by createCredentialProvider sign in', async () => {
    const { accountId, email } =
      await createAccountWithoutCredentialRow('restored')

    await database().createCredentialProvider({
      accountId,
      passwordHash: await bcrypt.hash(PASSWORD, 10)
    })

    expect(await signIn(email, PASSWORD)).toBe(200)
  })

  it('lets an account whose password was reset by code sign in', async () => {
    const { email } = await createAccountWithoutCredentialRow('reset')
    const passwordResetCode = 'reset-code-1'
    await database().requestPasswordReset({ email, passwordResetCode })

    await database().resetPasswordWithCode({
      passwordResetCode,
      newPasswordHash: await bcrypt.hash(NEW_PASSWORD, 10)
    })

    expect(await signIn(email, NEW_PASSWORD)).toBe(200)
  })

  it('lets an account whose password was changed sign in', async () => {
    const { accountId, email } =
      await createAccountWithoutCredentialRow('changed')

    await database().changePassword({
      accountId,
      newPasswordHash: await bcrypt.hash(NEW_PASSWORD, 10)
    })

    expect(await signIn(email, NEW_PASSWORD)).toBe(200)
  })
})

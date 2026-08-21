import bcrypt from 'bcrypt'
import knex, { Knex } from 'knex'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// End-to-end guard for `experimental.joins` (see `auth.ts`). On better-auth
// 1.6.x that flag makes the adapter factory read the joined rows straight off
// whatever the adapter returned — there is no capability check and no fallback,
// so an adapter that ignored `join` resolves every session to `null` while
// every unit test still passes. This test drives the real better-auth instance
// against a real database and asserts a signed-in session still comes back with
// its account attached.
const holder = vi.hoisted(() => ({ knex: null as Knex | null }))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'test.example.com',
    serviceName: 'Activities.next Test',
    secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
    trustedHosts: []
  }),
  getBaseURL: () => 'https://test.example.com'
}))

vi.mock('@/lib/database', () => ({
  getKnex: () => holder.knex,
  // Null skips the session-create hook's account gate, which is not what this
  // test is about; the join contract is exercised either way.
  getDatabase: () => null
}))

const SQLITE_SCHEMA_PATH = fileURLToPath(
  new URL('../../../migrations/schema.sqlite.sql', import.meta.url)
)

const ACCOUNT_ID = 'account-1'
const EMAIL = 'session-joins@test.example.com'
const PASSWORD = 'test-password-123'

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

const signIn = async () => {
  const { getAuth } = await import('@/lib/services/auth/auth')
  const auth = getAuth('https://test.example.com')
  const response = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    headers: new Headers({ origin: 'https://test.example.com' }),
    asResponse: true
  })
  const cookie = response.headers.get('set-cookie')
  if (!cookie) throw new Error('sign in did not set a session cookie')
  return { auth, cookie }
}

describe('session resolution with database joins', () => {
  beforeAll(async () => {
    holder.knex = await buildInMemoryKnex()

    await holder.knex('accounts').insert({
      id: ACCOUNT_ID,
      email: EMAIL,
      name: 'Session Joins',
      emailVerified: true
    })
    await holder.knex('account_providers').insert({
      id: 'account-provider-1',
      accountId: ACCOUNT_ID,
      provider: 'credential',
      // better-auth 1.7's `signInEmail` matches the credential row on `issuer`
      // too, so the literal is the contract this fixture stands in for.
      issuer: 'local:credential',
      providerId: ACCOUNT_ID,
      password: await bcrypt.hash(PASSWORD, 10)
    })
  })

  afterAll(async () => {
    await holder.knex?.destroy()
  })

  it('returns the session together with its account', async () => {
    const { auth, cookie } = await signIn()

    const session = await auth.api.getSession({
      headers: new Headers({ cookie })
    })

    // The regression this guards: a `join` the adapter does not answer makes
    // `findSession` return null here, which reads as "signed out" everywhere.
    expect(session).not.toBeNull()
    expect(session?.user.email).toBe(EMAIL)
    expect(session?.user.id).toBe(ACCOUNT_ID)
    expect(session?.session.token).toBeTruthy()
  })

  it('reads the account in the same statement as the session', async () => {
    const { auth, cookie } = await signIn()

    const statements: string[] = []
    const record = ({ sql }: { sql: string }) => statements.push(sql)
    holder.knex?.on('query', record)
    try {
      await auth.api.getSession({ headers: new Headers({ cookie }) })
    } finally {
      holder.knex?.off('query', record)
    }

    const sessionReads = statements.filter(
      (sql) => sql.includes('from `sessions`') && sql.startsWith('select')
    )
    expect(sessionReads.length).toBeGreaterThan(0)
    expect(
      sessionReads.some((sql) => sql.includes('left join `accounts`'))
    ).toBe(true)
    // The point of the join: no second statement to fetch the account.
    expect(
      statements.filter(
        (sql) => sql.startsWith('select') && sql.includes('from `accounts`')
      )
    ).toHaveLength(0)
  })
})

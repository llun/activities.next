import bcrypt from 'bcrypt'

import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'

// End-to-end guard for `advanced.database.joins` (see `auth.ts`), which is
// where better-auth 1.7 moved the flag from `experimental.joins`. Unknown
// option keys are accepted silently, so the stale key neither failed to compile
// nor warned — it just stopped requesting joins, and every authenticated
// request quietly cost a second statement again. That is what the
// single-statement assertion below is really guarding.
//
// On 1.6.x the flag was an assertion rather than a request: the factory read
// the joined rows straight off whatever the adapter returned, with no
// capability check and no fallback, so an adapter that ignored `join` resolved
// every session to `null` — every signed-in user silently logged out — while
// every unit test still passed. 1.7 falls back to separate queries instead,
// which turns that outage into the slower path this test rejects. Either way
// the check has to drive the real better-auth instance against a real database;
// the adapter's own unit tests never see the factory's transform.
const holder = vi.hoisted(() => ({
  testDb: null as TestDatabase | null
}))

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
  getKysely: () => holder.testDb?.db,
  // Null skips the session-create hook's account gate, which is not what this
  // test is about; the join contract is exercised either way.
  getDatabase: () => null
}))

const ACCOUNT_ID = 'account-1'
const EMAIL = 'session-joins@test.example.com'
const PASSWORD = 'test-password-123'
// The lowest cost bcrypt accepts: fixtures only need a valid hash, and
// bcrypt.compare reads the cost from it (production hashes at 10).
const TEST_BCRYPT_COST = 4

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
    const testDb = createTestDatabase()
    await testDb.prepare()
    await testDb.database.migrate()
    holder.testDb = testDb

    await testDb.db
      .insertInto('accounts')
      .values({
        id: ACCOUNT_ID,
        email: EMAIL,
        name: 'Session Joins',
        emailVerified: true
      })
      .execute()
    await testDb.db
      .insertInto('account_providers')
      .values({
        id: 'account-provider-1',
        accountId: ACCOUNT_ID,
        provider: 'credential',
        // Better Auth 1.7.3 keys credentials by provider + provider-side
        // account id. The historical issuer column is intentionally absent
        // here.
        providerId: ACCOUNT_ID,
        password: await bcrypt.hash(PASSWORD, TEST_BCRYPT_COST)
      })
      .execute()
  })

  afterAll(async () => {
    await holder.testDb?.destroy()
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

    // The adapter's Kysely instance borrows the test database's Knex pool,
    // which announces every statement it runs.
    const knex = holder.testDb?.knex
    const statements: string[] = []
    const record = ({ sql }: { sql: string }) => statements.push(sql)
    knex?.on('query', record)
    try {
      await auth.api.getSession({ headers: new Headers({ cookie }) })
    } finally {
      knex?.off('query', record)
    }

    const sessionReads = statements.filter(
      (sql) => sql.includes('from "sessions"') && sql.startsWith('select')
    )
    expect(sessionReads).toHaveLength(1)
    expect(sessionReads[0]).toContain(
      'left join "accounts" on "sessions"."accountId" = "accounts"."id"'
    )
    // The point of the join: no second statement to fetch the account.
    expect(
      statements.filter(
        (sql) => sql.startsWith('select') && sql.includes('from "accounts"')
      )
    ).toHaveLength(0)
  })
})

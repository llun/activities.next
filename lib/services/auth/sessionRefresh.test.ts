import bcrypt from 'bcrypt'
import knex, { Knex } from 'knex'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// End-to-end guard for where a session is allowed to slide forward. A
// better-auth refresh does two writes: it extends the database `expireAt` and
// re-issues the cookie with a fresh Max-Age. A Server Component cannot set a
// cookie, so when `getServerAuthSession` was allowed to refresh, only the first
// write landed — the browser cookie kept the Max-Age from sign-in and every
// user was signed out seven days later however active they were. These drive
// the real better-auth instance, because the refresh decision and the
// `Set-Cookie` both live inside it.
const holder = vi.hoisted(() => ({
  knex: null as Knex | null,
  cookie: ''
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
  getKnex: () => holder.knex,
  // Null skips the session-create hook's account gate, which is not what this
  // test is about.
  getDatabase: () => null
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: holder.cookie })
}))

const SQLITE_SCHEMA_PATH = fileURLToPath(
  new URL('../../../migrations/schema.sqlite.sql', import.meta.url)
)

const BASE_URL = 'https://test.example.com'
const ACCOUNT_ID = 'account-1'
const EMAIL = 'session-refresh@test.example.com'
const PASSWORD = 'test-password-123'
// The lowest cost bcrypt accepts: fixtures only need a valid hash, and
// bcrypt.compare reads the cost from it (production hashes at 10).
const TEST_BCRYPT_COST = 4
const DAY_MS = 24 * 60 * 60 * 1000
// better-auth's default `session.expiresIn`, which `auth.ts` leaves in place.
const SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60

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

// Signs in and returns the `name=value` pair the browser would send back.
const signIn = async () => {
  const { getAuth } = await import('@/lib/services/auth/auth')
  const auth = getAuth(BASE_URL)
  const response = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    headers: new Headers({ origin: BASE_URL }),
    asResponse: true
  })
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('sign in did not set a session cookie')
  return { auth, cookie: setCookie.split(';')[0] }
}

// Moves every session to two days into its seven-day life, which is past
// better-auth's default one-day `updateAge`, so the next refreshing read
// slides it forward.
const ageSessions = async () => {
  await holder.knex?.('sessions').update({
    expireAt: new Date(Date.now() + 5 * DAY_MS)
  })
}

const readSessionExpiry = async (): Promise<number> => {
  const row = await holder.knex?.('sessions').first('expireAt')
  return new Date(row?.expireAt).getTime()
}

describe('session refresh', () => {
  beforeAll(async () => {
    holder.knex = await buildInMemoryKnex()

    await holder.knex('accounts').insert({
      id: ACCOUNT_ID,
      email: EMAIL,
      name: 'Session Refresh',
      emailVerified: true
    })
    await holder.knex('account_providers').insert({
      id: 'account-provider-1',
      accountId: ACCOUNT_ID,
      provider: 'credential',
      providerId: ACCOUNT_ID,
      password: await bcrypt.hash(PASSWORD, TEST_BCRYPT_COST)
    })
  })

  beforeEach(async () => {
    await holder.knex?.('sessions').delete()
  })

  afterAll(async () => {
    await holder.knex?.destroy()
  })

  it('leaves a due session untouched when it is read during a server render', async () => {
    const { cookie } = await signIn()
    await ageSessions()
    const expiryBefore = await readSessionExpiry()
    holder.cookie = cookie

    const { getServerAuthSession } = await import('./getSession')
    const session = await getServerAuthSession()

    expect(session?.user.id).toBe(ACCOUNT_ID)
    // A refresh here would extend the row while the cookie it re-issues is
    // dropped, which is exactly the divergence that signed users out.
    expect(await readSessionExpiry()).toBe(expiryBefore)
  })

  it('extends a due session and re-issues its cookie through the get-session endpoint', async () => {
    const { auth, cookie } = await signIn()
    await ageSessions()
    const expiryBefore = await readSessionExpiry()

    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/get-session`, {
        headers: { cookie }
      })
    )

    expect(response.status).toBe(200)
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(cookie.split('=')[0])
    expect(setCookie).toContain(`Max-Age=${SESSION_EXPIRES_IN_SECONDS}`)
    // The row moved by the same amount the cookie's Max-Age was reset to.
    expect(await readSessionExpiry()).toBeGreaterThan(expiryBefore + DAY_MS)
  })
})

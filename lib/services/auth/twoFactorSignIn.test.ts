import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import bcrypt from 'bcrypt'
import knex, { Knex } from 'knex'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

// Boot the real better-auth instance (with the two-factor plugin) against an
// in-memory SQLite database built from the committed schema dump, and drive the
// full 2FA lifecycle end to end: enable -> verify -> fresh sign-in challenge ->
// verify. This is the regression guard for the "Invalid two factor cookie" bug:
// better-auth's two-factor plugin writes `failedVerificationCount`/`lockedUntil`
// on the `twoFactor` table, and when those columns are missing from the schema,
// `enable`/`verify-totp` throw a 500 that leaves the sign-in challenge in a state
// where the retry fails with INVALID_TWO_FACTOR_COOKIE. If the schema dump drifts
// away from the migrations again, the final verification here fails.
const HOST = 'test.example.com'
const BASE_URL = `https://${HOST}`
const EMAIL = 'twofactor@example.com'
const PASSWORD = 'testpassword123'

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

// Split a comma-merged Set-Cookie header into individual cookies. The runtime's
// Response here exposes no `getSetCookie()`, and a naive comma split breaks on the
// commas inside `Expires=Thu, 01 Jan 1970 …` used to clear cookies, so use the
// standard set-cookie-parser algorithm that only splits before a real name=value.
const splitSetCookies = (header: string): string[] => {
  const cookies: string[] = []
  let pos = 0
  const skipWhitespace = () => {
    while (pos < header.length && /\s/.test(header.charAt(pos))) pos++
    return pos < header.length
  }
  const notSpecialChar = () => {
    const ch = header.charAt(pos)
    return ch !== '=' && ch !== ';' && ch !== ','
  }
  while (pos < header.length) {
    let start = pos
    let separatorFound = false
    while (skipWhitespace()) {
      if (header.charAt(pos) === ',') {
        const lastComma = pos
        pos += 1
        skipWhitespace()
        const nextStart = pos
        while (pos < header.length && notSpecialChar()) pos += 1
        if (pos < header.length && header.charAt(pos) === '=') {
          separatorFound = true
          pos = nextStart
          cookies.push(header.substring(start, lastComma))
          start = pos
        } else {
          pos = lastComma + 1
        }
      } else {
        pos += 1
      }
    }
    if (!separatorFound || pos >= header.length) {
      cookies.push(header.substring(start, header.length))
    }
  }
  return cookies
}

describe('two-factor sign-in flow', () => {
  // A cookie jar that mirrors a browser across the sequential auth requests.
  const jar: Record<string, string> = {}

  const absorb = (response: Response) => {
    const header = response.headers.get('set-cookie')
    if (!header) return
    for (const raw of splitSetCookies(header)) {
      const [pair] = raw.split(';')
      const index = pair.indexOf('=')
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      if (value === '' || /expires=thu, 01 jan 1970/i.test(raw))
        delete jar[name]
      else jar[name] = value
    }
  }

  const cookieHeader = () =>
    Object.entries(jar)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')

  const post = async (path: string, body: unknown) => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    const response = await getAuth(BASE_URL).handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: BASE_URL,
          cookie: cookieHeader()
        },
        body: JSON.stringify(body)
      })
    )
    absorb(response)
    const text = await response.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
    return { status: response.status, json: json as Record<string, unknown> }
  }

  beforeAll(async () => {
    holder.knex = await buildInMemoryKnex()
    holder.database = getSQLDatabase(holder.knex)
    await holder.database.createAccount({
      domain: HOST,
      email: EMAIL,
      username: 'twofactor',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      publicKey: 'test-public-key',
      privateKey: 'test-private-key'
    })
  })

  afterAll(async () => {
    await holder.knex?.destroy()
  })

  it('completes verify-totp on the sign-in challenge without a cookie error', async () => {
    // Sign in once to obtain a session, then enable 2FA for this account.
    const initialSignIn = await post('/sign-in/email', {
      email: EMAIL,
      password: PASSWORD
    })
    expect(initialSignIn.status).toBe(200)

    const enable = await post('/two-factor/enable', { password: PASSWORD })
    expect(enable.status).toBe(200)
    const totpURI = enable.json.totpURI as string
    // The otpauth URI carries the base32-encoded secret. better-auth stores the
    // secret as a string (`generateRandomString`, ASCII only) and createOTP keys
    // the HMAC on that string — a non-string secret is forwarded to
    // `crypto.subtle.sign` as an already-imported key, so a raw Uint8Array can't
    // stand in. Decode the base32 bytes back into the original ASCII string; the
    // round-trip is lossless because the secret is ASCII.
    const rawSecret = new TextDecoder().decode(
      base32.decode(new URL(totpURI).searchParams.get('secret') as string)
    )
    const code = () => createOTP(rawSecret, { period: 30, digits: 6 }).totp()

    // Verifying a first code finishes enabling 2FA.
    const finishEnable = await post('/two-factor/verify-totp', {
      code: await code()
    })
    expect(finishEnable.status).toBe(200)

    // New browser session: clear cookies and sign in from scratch.
    for (const name of Object.keys(jar)) delete jar[name]

    const challenge = await post('/sign-in/email', {
      email: EMAIL,
      password: PASSWORD
    })
    expect(challenge.status).toBe(200)
    // With 2FA enabled the credential step returns a redirect flag and sets the
    // short-lived two-factor cookie instead of a session.
    expect(challenge.json.twoFactorRedirect).toBe(true)
    // On a secure (https) base URL better-auth uses the `__Secure-` cookie
    // prefix, so match the two-factor cookie by suffix rather than exact name.
    expect(Object.keys(jar).some((name) => name.endsWith('two_factor'))).toBe(
      true
    )

    // Completing the challenge must succeed and issue a session token — before
    // the fix this returned 401 "Invalid two factor cookie".
    const verify = await post('/two-factor/verify-totp', {
      code: await code(),
      trustDevice: true
    })
    expect(verify.status).toBe(200)
    expect(verify.json.token).toBeTruthy()
  })
})

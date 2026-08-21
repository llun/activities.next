import bcrypt from 'bcrypt'
import knex, { Knex } from 'knex'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

// Every Mastodon client signs in through this flow, and until now nothing
// exercised it: `app/(nosidebar)/oauth/token/route.test.ts` mocks `getAuth`, so
// the whole better-auth OAuth surface was untested. A better-auth 1.7 upgrade
// consequently shipped a green suite while approving consent 500'd on every
// request — the plugin had started writing `oauthConsent.requestedUserInfoClaims`
// and the column did not exist.
//
// So this drives the real better-auth handler end to end against a database
// built from the committed schema dump: sign in, authorize, approve consent,
// exchange the code. Each step's DB writes are what the assertions are really
// about, which is why the flow is followed all the way to an access token
// rather than stopping at the first 200.
const HOST = 'test.example.com'
const BASE_URL = `https://${HOST}`
const EMAIL = 'oauth-flow@example.com'
const PASSWORD = 'testpassword123'
const CLIENT_ID = 'flow-test-client'
const CLIENT_SECRET = 'flow-test-secret'
const REDIRECT_URI = 'https://client.example.com/callback'

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

// Mirrors `hashClientSecret` in app/api/v1/apps/createApplication.ts, which is
// what actually populates this column — storing the plaintext would make the
// token exchange fail for a reason that has nothing to do with the flow.
const hashClientSecret = (secret: string) =>
  crypto
    .createHash('sha256')
    .update(secret)
    .digest()
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

describe('OAuth provider authorization code flow', () => {
  let database: Knex
  const jar: Record<string, string> = {}

  const absorb = (response: Response) => {
    const header = response.headers.get('set-cookie')
    if (!header) return
    for (const raw of header.split(/,(?=[^;]+?=)/)) {
      const [pair] = raw.split(';')
      const index = pair.indexOf('=')
      jar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim()
    }
  }

  const call = async (path: string, init: RequestInit = {}) => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    const response = await getAuth(BASE_URL).handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        ...init,
        headers: {
          origin: BASE_URL,
          cookie: Object.entries(jar)
            .map(([name, value]) => `${name}=${value}`)
            .join('; '),
          ...(init.headers as Record<string, string> | undefined)
        }
      })
    )
    absorb(response)
    return {
      status: response.status,
      location: response.headers.get('location'),
      text: await response.text()
    }
  }

  beforeAll(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    const connection = await database.client.acquireConnection()
    try {
      connection.exec(readFileSync(SQLITE_SCHEMA_PATH, 'utf8'))
    } finally {
      await database.client.releaseConnection(connection)
    }
    holder.knex = database
    holder.database = getSQLDatabase(database)

    await holder.database.createAccount({
      domain: HOST,
      email: EMAIL,
      username: 'oauthflow',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      publicKey: 'test-public-key',
      privateKey: 'test-private-key'
    })

    await database('oauthClient').insert({
      id: crypto.randomUUID(),
      clientId: CLIENT_ID,
      clientSecret: hashClientSecret(CLIENT_SECRET),
      name: 'Flow Test',
      redirectUris: JSON.stringify([REDIRECT_URI]),
      scopes: JSON.stringify(['read', 'write']),
      type: 'web',
      disabled: false
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('issues an access token through authorize, consent and token exchange', async () => {
    const signIn = await call('/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD })
    })
    expect(signIn.status).toBe(200)

    // PKCE is mandatory for this provider, so a flow without it never reaches
    // the code path under test.
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url')

    const authorize = await call(
      `/oauth2/authorize?${new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'read write',
        state: 'state-value',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      })}`,
      { method: 'GET', redirect: 'manual' }
    )
    // Redirects to our own consent screen, carrying better-auth's signed query.
    expect(authorize.status).toBe(302)
    expect(authorize.location).toContain('/oauth/authorize?')

    // AuthorizeCard forwards that signed query back with the approval; without
    // it the consent endpoint answers "missing oauth query".
    const oauthQuery = authorize.location?.slice(
      authorize.location.indexOf('?')
    )
    const consent = await call('/oauth2/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accept: true,
        scope: 'read write',
        oauth_query: oauthQuery
      })
    })
    // The regression this guards: approving consent INSERTs an oauthConsent
    // row, so a column the plugin writes and the schema lacks surfaces here as
    // a 500 and the authorize page falls through to `server_error`.
    expect(consent.status).toBe(200)

    const consentBody = JSON.parse(consent.text) as { url?: string }
    const code = consentBody.url
      ? new URL(consentBody.url).searchParams.get('code')
      : null
    expect(code).toBeTruthy()

    const token = await call('/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // This client is registered for client_secret_basic.
        authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier
      }).toString()
    })
    // Writes oauthAccessToken and oauthRefreshToken rows, which is the second
    // place a missing plugin column shows up.
    expect(token.status).toBe(200)

    const tokenBody = JSON.parse(token.text) as {
      access_token?: string
      token_type?: string
      scope?: string
    }
    expect(tokenBody.access_token).toBeTruthy()
    expect(tokenBody.token_type).toBe('Bearer')
    expect(tokenBody.scope).toBe('read write')

    const stored = await database('oauthAccessToken').first()
    expect(stored).toBeDefined()
  })
})

import bcrypt from 'bcrypt'
import knex, { Knex } from 'knex'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createApplication } from '@/app/api/v1/apps/createApplication'
import type { SuccessResponse } from '@/app/api/v1/apps/types'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

// Every Mastodon client signs in through these grants, and until now nothing
// exercised them: `app/(nosidebar)/oauth/token/route.test.ts` mocks `getAuth`, so
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
//
// The `client_credentials` grant is driven the same way, and for the same
// reason: the 1.7 upgrade moved its scope ceiling to a column nothing wrote, so
// every app token request started coming back `unauthorized_client` with the
// suite still green.
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

describe('OAuth provider token grants', () => {
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

  // A Mastodon client asks for an app-level token before any user is involved:
  // Ivory posts `grant_type=client_credentials` with the credentials
  // `POST /api/v1/apps` just handed it, and only then offers to sign a user in.
  // better-auth 1.7 gates that grant on a server-owned `clientCredentialsScopes`
  // ceiling — a column 1.6 did not have and which the registration path has to
  // populate, or the request comes back `400 unauthorized_client` and the client
  // never reaches the sign-in step. So this registers through the real
  // production path rather than inserting a row, because the row that path
  // writes is exactly what the regression was about.
  it('issues an app token for a client registered through /api/v1/apps', async () => {
    const registration = await createApplication({
      client_name: 'Client Credentials Test',
      redirect_uris: 'com.example.app:/request_token/callback',
      scopes: 'read write follow push'
    })
    expect(registration.type).toBe('success')
    const application = registration as SuccessResponse

    const token = await call('/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // The production proxy strips `cookie` before forwarding, so this grant
        // is authenticated by the client credentials alone. Sending none also
        // keeps the test independent of the session the flow above left behind.
        cookie: ''
      },
      // The parameters Ivory sends, `redirect_uri` included — it posts the same
      // body it would for an authorization code exchange.
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: application.client_id,
        client_secret: application.client_secret,
        redirect_uri: 'com.example.app:/request_token/callback',
        scope: 'read write follow push'
      }).toString()
    })
    expect(token.status).toBe(200)

    const tokenBody = JSON.parse(token.text) as {
      access_token?: string
      scope?: string
    }
    expect(tokenBody.access_token).toBeTruthy()
    expect(tokenBody.scope).toBe('read write follow push')

    // An app token carries no user, which is what `OAuthAppGuard` reads to tell
    // one apart from a user-delegated token.
    const stored = await database('oauthAccessToken')
      .where('clientId', application.client_id)
      .first()
    expect(stored).toBeDefined()
    expect(stored?.userId ?? null).toBeNull()
  })
})

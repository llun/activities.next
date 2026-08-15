import knex, { Knex } from 'knex'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { AUTH_ERROR_PATH } from '@/lib/services/auth/constants'

// A fresh in-memory SQLite database stands in for the deployment database so the
// real better-auth instance is built exactly as production builds it.
const holder = vi.hoisted(() => ({ knex: null as Knex | null }))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'test.example.com',
    serviceName: 'Activities.next Test',
    // Long enough that better-auth does not warn about a weak secret.
    secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
    trustedHosts: []
  }),
  getBaseURL: () => 'https://test.example.com'
}))

vi.mock('@/lib/database', () => ({
  getKnex: () => holder.knex,
  getDatabase: () => null
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

// Drive the real handler rather than reading `auth.options` back, so this pins
// the behaviour (where does a failed request actually send the browser?) rather
// than the config shape. A better-auth release that changes how it consumes
// `onAPIError.errorURL` fails here too.
const locationFor = async (path: string) => {
  const { getAuth } = await import('@/lib/services/auth/auth')
  const auth = getAuth('https://test.example.com')
  const response = await auth.handler(
    new Request(`https://test.example.com${path}`, {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0'
      }
    })
  )
  return { status: response.status, location: response.headers.get('location') }
}

describe('onAPIError.errorURL', () => {
  beforeAll(async () => {
    holder.knex = await buildInMemoryKnex()
  })

  afterAll(async () => {
    await holder.knex?.destroy()
  })

  // Without onAPIError.errorURL this answers `/?error=...` in production —
  // dropping a failed sign-in on the home timeline, which is the whole reason
  // the option is set.
  it('sends better-auth its own error endpoint to the in-app page', async () => {
    const { status, location } = await locationFor(
      '/api/auth/error?error=invalid_client&error_description=client_id+is+required'
    )

    expect(status).toBe(302)
    expect(location).toEqual(
      `${AUTH_ERROR_PATH}?error=invalid_client&error_description=client_id+is+required`
    )
  })

  // The oauth-provider plugin builds its own redirect from the same option, so
  // it needs covering separately from the core /error endpoint above.
  it('sends an authorize rejection to the in-app page', async () => {
    const { status, location } = await locationFor(
      '/api/auth/oauth2/authorize?client_id=does-not-exist&response_type=code&redirect_uri=https%3A%2F%2Fphanpy.local%2F'
    )

    expect(status).toBe(302)
    // startsWith, not toContain: better-auth's untouched default is
    // `/api/auth/error?...`, which CONTAINS `/auth/error?...` as a substring and
    // would let this pass with the option removed.
    expect(
      location?.startsWith(`${AUTH_ERROR_PATH}?error=invalid_client`)
    ).toBe(true)
  })

  // A relative Location keeps the visitor on the host the request arrived on.
  // An absolute URL built from getBaseURL() would bounce a login started on a
  // trusted alias domain over to ACTIVITIES_HOST mid-flow.
  it('redirects to a root-relative path so the visitor keeps their host', async () => {
    const { location } = await locationFor(
      '/api/auth/error?error=invalid_client'
    )

    expect(location?.startsWith('/')).toBe(true)
    expect(location?.startsWith('//')).toBe(false)
  })
})

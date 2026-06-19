import knex, { Knex } from 'knex'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { getOpenIDConfiguration } from '@/lib/services/wellknown/openidConfiguration'

// A fresh in-memory SQLite database stands in for the deployment database so the
// real better-auth instance (and its jwt plugin) provisions a real signing key.
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
  // The jwt plugin only needs the Knex handle (via knexAdapter); the higher
  // level Database is unused on the public /jwks path, so null is sufficient.
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

describe('OIDC JWKS (RS256)', () => {
  beforeAll(async () => {
    holder.knex = await buildInMemoryKnex()
  })

  afterAll(async () => {
    await holder.knex?.destroy()
  })

  const fetchJwks = async () => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    const auth = getAuth('https://test.example.com')
    const response = await auth.handler(
      new Request('https://test.example.com/api/auth/jwks', { method: 'GET' })
    )
    expect(response.status).toBe(200)
    return response.json() as Promise<{
      keys: Array<Record<string, unknown>>
    }>
  }

  it('publishes an RS256/RSA verification key with a kid at /api/auth/jwks', async () => {
    const jwks = await fetchJwks()

    expect(Array.isArray(jwks.keys)).toBe(true)
    expect(jwks.keys.length).toBeGreaterThanOrEqual(1)

    const rsaKey = jwks.keys.find((key) => key.kty === 'RSA')
    expect(rsaKey).toBeDefined()
    // The discovery document advertises id_token_signing_alg RS256, so the
    // published verification key MUST be an RSA key with a matching alg/kid.
    expect(rsaKey).toMatchObject({ kty: 'RSA', alg: 'RS256' })
    expect(rsaKey?.kid).toBeString()
    expect(rsaKey?.kid).toBeTruthy()
    // RSA public material is present; private material is never published.
    expect(rsaKey?.n).toBeString()
    expect(rsaKey?.e).toBeString()
    expect(rsaKey).not.toHaveProperty('d')
  })

  it('does not publish an EdDSA/OKP key (the pre-RS256 default)', async () => {
    const jwks = await fetchJwks()

    // A leftover EdDSA key would be served stamped with the configured RS256
    // alg and could never verify; the published set must be RSA-only.
    expect(jwks.keys.some((key) => key.kty === 'OKP')).toBe(false)
    expect(jwks.keys.every((key) => key.alg === 'RS256')).toBe(true)
  })

  it('advertises the JWKS endpoint that serves this RS256 key in discovery', () => {
    const config = getOpenIDConfiguration()

    expect(config.jwks_uri).toBe('https://test.example.com/api/auth/jwks')
    expect(config.id_token_signing_alg_values_supported).toEqual(['RS256'])
  })
})

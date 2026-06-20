import { decodeProtectedHeader, exportJWK, generateKeyPair } from 'jose'
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

// Reproduces the production 500: a deployment that signed tokens before the
// RS256 switch still has the jwt plugin's old Ed25519/OKP key in `jwks`. Because
// the table has no per-key `alg` column, better-auth would load that key and try
// to sign it as the configured RS256, which jose rejects with
// `Invalid or unsupported JWK "alg" (Algorithm) Parameter value` — 500ing every
// authenticated request. The getJwks RSA filter must hide the stale key so the
// instance self-heals with a fresh RSA key.
describe('OIDC JWKS with a stale pre-RS256 EdDSA key', () => {
  // A distinct base URL so getAuth() builds a fresh instance bound to this
  // describe's database rather than reusing the cached one from above.
  const BASE_URL = 'https://stale-key.example.com'

  beforeAll(async () => {
    // Reset the module registry so getAuth's per-baseURL instance cache from the
    // previous describe can't bridge to this block's database; the fresh import
    // in getStaleKeyAuth then builds an instance bound to the seeded DB below.
    vi.resetModules()
    holder.knex = await buildInMemoryKnex()

    // Seed the exact row the pre-RS256 plugin left behind: an Ed25519/OKP public
    // key. The private key is never read because the RSA filter drops this row
    // before anything imports it, so a placeholder is enough.
    const { publicKey } = await generateKeyPair('EdDSA', { extractable: true })
    await holder.knex('jwks').insert({
      id: 'stale-eddsa-key',
      publicKey: JSON.stringify(await exportJWK(publicKey)),
      privateKey: JSON.stringify({ placeholder: true }),
      createdAt: new Date().toISOString()
    })
  })

  afterAll(async () => {
    await holder.knex?.destroy()
  })

  const getStaleKeyAuth = async () => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    return getAuth(BASE_URL)
  }

  it('publishes only an RSA key and hides the stale EdDSA key', async () => {
    const auth = await getStaleKeyAuth()
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/jwks`, { method: 'GET' })
    )

    expect(response.status).toBe(200)
    const jwks = (await response.json()) as {
      keys: Array<Record<string, unknown>>
    }

    // The OKP key is filtered out so it is never published stamped with the
    // configured RS256 (which no RP could verify); better-auth regenerates an RSA
    // key, so the published set is RSA-only and matches the advertised RS256.
    expect(jwks.keys.length).toBeGreaterThanOrEqual(1)
    expect(jwks.keys.some((key) => key.kty === 'OKP')).toBe(false)
    expect(jwks.keys.every((key) => key.kty === 'RSA')).toBe(true)
    expect(jwks.keys.every((key) => key.alg === 'RS256')).toBe(true)
  })

  it('signs a JWT with the fresh RSA key rather than throwing on the stale key', async () => {
    const auth = await getStaleKeyAuth()

    // signJWT drives the same getLatestKey path as the `/get-session` hook that
    // 500s in production. With the stale key filtered out it must succeed and
    // sign with RS256, never importing the Ed25519 key as RS256.
    const result = (await auth.api.signJWT({
      body: { payload: { sub: 'account-1' } }
    })) as { token: string }

    expect(typeof result.token).toBe('string')
    expect(decodeProtectedHeader(result.token).alg).toBe('RS256')
  })
})

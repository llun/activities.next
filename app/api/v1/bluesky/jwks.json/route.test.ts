import { JoseKey } from '@atproto/oauth-client-node'
import { NextRequest } from 'next/server'

import { GET as getMetadata } from '@/app/api/v1/bluesky/client-metadata.json/route'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

import { GET as getJwks } from './route'

vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: vi.fn()
}))
vi.mock('@/lib/database', () => ({ getDatabase: vi.fn() }))

const call = (handler: typeof getJwks, path: string, host = 'social.example') =>
  handler(new NextRequest(`https://${host}${path}`, { headers: { host } }), {
    params: Promise.resolve({})
  })

describe('Bluesky OAuth client documents', () => {
  const testDb = createTestDatabase()

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  afterAll(async () => {
    await testDb.database.destroy()
  })

  beforeEach(() => {
    vi.mocked(getDatabase).mockReturnValue(testDb.database)
  })

  it('answers 404 for both when no keys are set', async () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret'
    } as never)
    expect((await call(getJwks, '/api/v1/bluesky/jwks.json')).status).toBe(404)
    expect(
      (await call(getMetadata, '/api/v1/bluesky/client-metadata.json')).status
    ).toBe(404)
  })

  it('publishes the client metadata and only the public key parts', async () => {
    const key = await JoseKey.generate(['ES256'], 'route-key')
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret',
      bluesky: { oauthPrivateKeys: [key.privateJwk] }
    } as never)

    const jwks = await call(getJwks, '/api/v1/bluesky/jwks.json')
    expect(jwks.status).toBe(200)
    const body = await jwks.json()
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0]).toMatchObject({ kid: 'route-key', kty: 'EC' })
    expect(body.keys[0]).not.toHaveProperty('d')

    const metadata = await call(
      getMetadata,
      '/api/v1/bluesky/client-metadata.json'
    )
    expect(await metadata.json()).toMatchObject({
      client_id: 'https://social.example/api/v1/bluesky/client-metadata.json',
      jwks_uri: 'https://social.example/api/v1/bluesky/jwks.json',
      token_endpoint_auth_method: 'private_key_jwt'
    })

    // Each served domain is its own client.
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      trustedHosts: ['other.example'],
      secretPhase: 'secret',
      bluesky: { oauthPrivateKeys: [key.privateJwk] }
    } as never)
    const other = await call(
      getMetadata,
      '/api/v1/bluesky/client-metadata.json',
      'other.example'
    )
    expect(await other.json()).toMatchObject({
      client_id: 'https://other.example/api/v1/bluesky/client-metadata.json',
      redirect_uris: ['https://other.example/api/v1/bluesky/callback']
    })
  })
})

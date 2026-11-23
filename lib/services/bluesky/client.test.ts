import { JoseKey } from '@atproto/oauth-client-node'

import { getBaseURL, getConfig } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  createBlueskyLock,
  getBlueskyOAuthClient,
  readStoredBlueskySession,
  writeStoredBlueskySession
} from '@/lib/services/bluesky/client'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
  getBaseURL: vi.fn()
}))

describe('Bluesky OAuth client', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.mocked(getBaseURL).mockReturnValue('https://social.example')
  })

  it('is off without keys', () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret'
    } as never)
    expect(getBlueskyOAuthClient(database)).toBeNull()
  })

  it('is a confidential DPoP client that publishes only public keys', async () => {
    const key = await JoseKey.generate(['ES256'], 'key-1')
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret',
      bluesky: { oauthPrivateKeys: [key.privateJwk] }
    } as never)

    const client = await getBlueskyOAuthClient(database)!
    expect(client.clientMetadata).toMatchObject({
      client_id: 'https://social.example/api/v1/bluesky/client-metadata.json',
      redirect_uris: ['https://social.example/api/v1/bluesky/callback'],
      jwks_uri: 'https://social.example/api/v1/bluesky/jwks.json',
      token_endpoint_auth_method: 'private_key_jwt',
      dpop_bound_access_tokens: true,
      scope: 'atproto transition:generic'
    })
    // As the jwks route serializes it.
    const published = JSON.parse(JSON.stringify(client.jwks))
    expect(published.keys).toHaveLength(1)
    expect(published.keys[0]).toMatchObject({ kid: 'key-1', kty: 'EC' })
    expect(published.keys[0]).not.toHaveProperty('d')
  })

  it('stores sessions encrypted and reads them back', async () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret'
    } as never)
    await writeStoredBlueskySession(database, 'did:plc:enc', {
      type: 'app_password',
      accessJwt: 'access-token-value',
      refreshJwt: 'refresh-token-value'
    })
    const raw = await database.getBlueskySession({ did: 'did:plc:enc' })
    expect(raw).not.toContain('refresh-token-value')
    expect(await readStoredBlueskySession(database, 'did:plc:enc')).toEqual({
      type: 'app_password',
      accessJwt: 'access-token-value',
      refreshJwt: 'refresh-token-value'
    })
  })

  it('runs one holder of a lock name at a time', async () => {
    const lock = createBlueskyLock(database)
    const events: string[] = []
    let release!: () => void
    const first = lock('refresh:did:plc:x', async () => {
      events.push('first start')
      await new Promise<void>((resolve) => {
        release = resolve
      })
      events.push('first end')
      return 1
    })
    await vi.waitFor(() => expect(events).toEqual(['first start']))
    const second = lock('refresh:did:plc:x', async () => {
      events.push('second')
      return 2
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(events).toEqual(['first start'])
    release()
    expect(await Promise.all([first, second])).toEqual([1, 2])
    expect(events).toEqual(['first start', 'first end', 'second'])
  })
})

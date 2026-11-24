import { JoseKey } from '@atproto/oauth-client-node'

import { getConfig } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  createBlueskyLock,
  deleteStoredBlueskySession,
  getBlueskyOAuthClient,
  readStoredBlueskySession,
  writeStoredBlueskySession
} from '@/lib/services/bluesky/client'

vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: vi.fn()
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

  it('is off without keys', () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret'
    } as never)
    expect(getBlueskyOAuthClient(database, 'social.example')).toBeNull()
  })

  it('is a confidential DPoP client that publishes only public keys', async () => {
    const key = await JoseKey.generate(['ES256'], 'key-1')
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret',
      bluesky: { oauthPrivateKeys: [key.privateJwk] }
    } as never)

    const client = await getBlueskyOAuthClient(database, 'social.example')!
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

  it('deletes a stored session of the asked type', async () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret'
    } as never)
    await writeStoredBlueskySession(database, 'did:plc:delete', {
      type: 'app_password',
      accessJwt: 'access-token-value',
      refreshJwt: 'refresh-token-value'
    })

    await deleteStoredBlueskySession(database, 'did:plc:delete', 'app_password')

    expect(
      await readStoredBlueskySession(database, 'did:plc:delete')
    ).toBeNull()
  })

  it('keeps an app_password session when asked to delete an oauth one', async () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret'
    } as never)
    await writeStoredBlueskySession(database, 'did:plc:keep-app', {
      type: 'app_password',
      accessJwt: 'access-token-value',
      refreshJwt: 'refresh-token-value'
    })

    await deleteStoredBlueskySession(database, 'did:plc:keep-app', 'oauth')

    expect(
      await readStoredBlueskySession(database, 'did:plc:keep-app')
    ).toEqual({
      type: 'app_password',
      accessJwt: 'access-token-value',
      refreshJwt: 'refresh-token-value'
    })
  })

  it('keeps an oauth session when asked to delete an app_password one', async () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret'
    } as never)
    await writeStoredBlueskySession(database, 'did:plc:keep-oauth', {
      type: 'oauth',
      session: { relinked: true } as never
    })

    await deleteStoredBlueskySession(
      database,
      'did:plc:keep-oauth',
      'app_password'
    )

    expect(
      await readStoredBlueskySession(database, 'did:plc:keep-oauth')
    ).toEqual({ type: 'oauth', session: { relinked: true } })
  })

  it('stores pending sign-ins encrypted, with an expiry', async () => {
    const key = await JoseKey.generate(['ES256'], 'key-state')
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret',
      bluesky: { oauthPrivateKeys: [key.privateJwk] }
    } as never)
    const client = await getBlueskyOAuthClient(database, 'social.example')!
    const stateStore = (
      client as unknown as {
        stateStore: {
          set(key: string, value: unknown): Promise<void>
          get(key: string): Promise<unknown>
        }
      }
    ).stateStore
    const dpopKey = await JoseKey.generate(['ES256'])
    await stateStore.set('state-key', {
      iss: 'https://auth.example.net',
      dpopKey,
      verifier: 'pkce-verifier-value',
      appState: 'actor-a'
    })

    const raw = await database.getBlueskyOAuthState({ key: 'state-key' })
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('pkce-verifier-value')
    expect(raw).not.toContain('actor-a')
    expect(await stateStore.get('state-key')).toMatchObject({
      verifier: 'pkce-verifier-value',
      appState: 'actor-a'
    })
    // Expires: gone an hour and a bit later.
    expect(
      await database.getBlueskyOAuthState({
        key: 'state-key',
        now: Date.now() + 61 * 60 * 1000
      })
    ).toBeNull()
  })

  it('locks each name on its own', async () => {
    const lock = createBlueskyLock(database)
    let release!: () => void
    const held = lock('refresh:did:plc:a', () => {
      return new Promise<void>((resolve) => {
        release = resolve
      })
    })
    await vi.waitFor(() => expect(release).toBeDefined())
    // Another DID's refresh does not wait for the first.
    expect(await lock('refresh:did:plc:b', async () => 'other')).toBe('other')
    release()
    await held
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

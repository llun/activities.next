import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

describe('BlueskyAccount', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  const link = (actorId: string, did: string) =>
    database.saveBlueskyAccount({
      actorId,
      did,
      handle: `${actorId}.example.com`,
      pdsUrl: 'https://pds.example.net/',
      authType: 'oauth',
      domainHandle: true
    })

  it('links one DID to one actor and refuses it for another actor', async () => {
    expect(await link('actor-1', 'did:plc:one')).toBe('saved')
    expect(await link('actor-2', 'did:plc:one')).toBe('did_taken')

    const account = await database.getBlueskyAccount({ actorId: 'actor-1' })
    expect(account).toMatchObject({
      did: 'did:plc:one',
      handle: 'actor-1.example.com',
      authType: 'oauth',
      domainHandle: true,
      instanceHandle: null
    })
    expect(await database.getBlueskyAccount({ actorId: 'actor-2' })).toBeNull()
    expect(
      await database.getBlueskyAccountByDid({ did: 'did:plc:one' })
    ).toMatchObject({ actorId: 'actor-1' })
  })

  it('replaces an actor’s link and drops the old DID’s session', async () => {
    await link('actor-3', 'did:plc:old')
    await database.setBlueskySession({ did: 'did:plc:old', session: 'old' })

    expect(await link('actor-3', 'did:plc:new')).toBe('saved')
    expect(await database.getBlueskySession({ did: 'did:plc:old' })).toBeNull()
    expect(
      (await database.getBlueskyAccount({ actorId: 'actor-3' }))?.did
    ).toBe('did:plc:new')
  })

  it('keeps the session when the same DID is linked again', async () => {
    await link('actor-4', 'did:plc:same')
    await database.setBlueskySession({ did: 'did:plc:same', session: 's1' })
    await link('actor-4', 'did:plc:same')
    expect(await database.getBlueskySession({ did: 'did:plc:same' })).toBe('s1')
  })

  it('lets one actor at a time answer for a host', async () => {
    await link('actor-5', 'did:plc:five')
    await link('actor-6', 'did:plc:six')

    expect(
      await database.setBlueskyInstanceHandle({
        actorId: 'actor-5',
        host: 'Social.Example'
      })
    ).toBe(true)
    expect(
      await database.setBlueskyInstanceHandle({
        actorId: 'actor-6',
        host: 'social.example'
      })
    ).toBe(false)
    expect(
      await database.getBlueskyAccountByInstanceHandle({
        host: 'social.example'
      })
    ).toMatchObject({ actorId: 'actor-5', did: 'did:plc:five' })

    await database.setBlueskyInstanceHandle({ actorId: 'actor-5', host: null })
    expect(
      await database.getBlueskyAccountByInstanceHandle({
        host: 'social.example'
      })
    ).toBeNull()
  })

  it('unlinks the account and its session', async () => {
    await link('actor-7', 'did:plc:seven')
    await database.setBlueskySession({ did: 'did:plc:seven', session: 's' })
    await database.deleteBlueskyAccount({ actorId: 'actor-7' })
    expect(await database.getBlueskyAccount({ actorId: 'actor-7' })).toBeNull()
    expect(
      await database.getBlueskySession({ did: 'did:plc:seven' })
    ).toBeNull()
  })

  it('upserts sessions', async () => {
    await database.setBlueskySession({ did: 'did:plc:s', session: 'a' })
    await database.setBlueskySession({ did: 'did:plc:s', session: 'b' })
    expect(await database.getBlueskySession({ did: 'did:plc:s' })).toBe('b')
    await database.deleteBlueskySession({ did: 'did:plc:s' })
    expect(await database.getBlueskySession({ did: 'did:plc:s' })).toBeNull()
  })

  it('expires OAuth states and prunes expired ones on write', async () => {
    const now = 1_800_000_000_000
    await database.setBlueskyOAuthState({
      key: 'stale',
      state: 'x',
      expiresAt: now + 1000,
      now
    })
    expect(
      await database.getBlueskyOAuthState({ key: 'stale', now: now + 10 })
    ).toBe('x')
    expect(
      await database.getBlueskyOAuthState({ key: 'stale', now: now + 2000 })
    ).toBeNull()

    await database.setBlueskyOAuthState({
      key: 'fresh',
      state: 'y',
      expiresAt: now + 10_000,
      now: now + 2000
    })
    // Pruned: still gone even when read with an earlier clock.
    expect(
      await database.getBlueskyOAuthState({ key: 'stale', now })
    ).toBeNull()

    await database.deleteBlueskyOAuthState({ key: 'fresh' })
    expect(
      await database.getBlueskyOAuthState({ key: 'fresh', now })
    ).toBeNull()
  })
})

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

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

  // A local actor whose account is an admin; returns the actor id.
  const createAdmin = async (username: string) => {
    const accountId = await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `privateKey-${username}`,
      publicKey: `publicKey-${username}`
    })
    await setRole(accountId, 'admin')
    return { accountId, actorId: `https://${TEST_DOMAIN}/users/${username}` }
  }
  const setRole = (accountId: string, role: string | null) =>
    testDb.db
      .updateTable('accounts')
      .set({ role })
      .where('id', '=', accountId)
      .execute()

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

  it('lets one active admin actor at a time answer for a host', async () => {
    const five = await createAdmin('bsky-five')
    const six = await createAdmin('bsky-six')
    await link(five.actorId, 'did:plc:five')
    await link(six.actorId, 'did:plc:six')

    expect(
      await database.setBlueskyInstanceHandle({
        actorId: five.actorId,
        host: 'Social.Example'
      })
    ).toBe(true)
    expect(
      await database.setBlueskyInstanceHandle({
        actorId: six.actorId,
        host: 'social.example'
      })
    ).toBe(false)
    expect(
      await database.getBlueskyAccountByInstanceHandle({
        host: 'social.example'
      })
    ).toMatchObject({ actorId: five.actorId, did: 'did:plc:five' })

    // Re-linking the same DID keeps the claim.
    await link(five.actorId, 'did:plc:five')
    expect(
      (await database.getBlueskyAccount({ actorId: five.actorId }))
        ?.instanceHandle
    ).toBe('social.example')

    // A holder who is no longer an admin answers nothing, and the claim can
    // be taken.
    await setRole(five.accountId, null)
    expect(
      await database.getBlueskyAccountByInstanceHandle({
        host: 'social.example'
      })
    ).toBeNull()
    expect(
      await database.setBlueskyInstanceHandle({
        actorId: six.actorId,
        host: 'social.example'
      })
    ).toBe(true)
    expect(
      await database.getBlueskyAccountByInstanceHandle({
        host: 'social.example'
      })
    ).toMatchObject({ actorId: six.actorId })
    expect(
      (await database.getBlueskyAccount({ actorId: five.actorId }))
        ?.instanceHandle
    ).toBeNull()

    await database.setBlueskyInstanceHandle({
      actorId: six.actorId,
      host: null
    })
    expect(
      await database.getBlueskyAccountByInstanceHandle({
        host: 'social.example'
      })
    ).toBeNull()
  })

  it('stops serving a claim whose account is disabled or actor suspended', async () => {
    const seven = await createAdmin('bsky-seven')
    await link(seven.actorId, 'did:plc:seven-claim')
    await database.setBlueskyInstanceHandle({
      actorId: seven.actorId,
      host: 'seven.example'
    })
    const lookup = () =>
      database.getBlueskyAccountByInstanceHandle({ host: 'seven.example' })
    expect(await lookup()).toMatchObject({ actorId: seven.actorId })

    await testDb.db
      .updateTable('accounts')
      .set({ disabledAt: new Date() })
      .where('id', '=', seven.accountId)
      .execute()
    expect(await lookup()).toBeNull()

    await testDb.db
      .updateTable('accounts')
      .set({ disabledAt: null })
      .where('id', '=', seven.accountId)
      .execute()
    await testDb.db
      .updateTable('actors')
      .set({ suspendedAt: new Date() })
      .where('id', '=', seven.actorId)
      .execute()
    expect(await lookup()).toBeNull()
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

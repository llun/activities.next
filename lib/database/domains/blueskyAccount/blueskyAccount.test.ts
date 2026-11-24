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

  const follow = (actorId: string) =>
    database.createBlueskyFollow({
      actorId,
      targetActorId: 'https://bsky.app/profile/did:plc:target',
      uri: 'at://did:plc:old/app.bsky.graph.follow/1'
    })

  it('replaces an actor’s link and drops the old DID’s session and follows', async () => {
    await link('actor-3', 'did:plc:old')
    await database.setBlueskySession({ did: 'did:plc:old', session: 'old' })
    await follow('actor-3')

    expect(await link('actor-3', 'did:plc:new')).toBe('saved')
    expect(await database.getBlueskySession({ did: 'did:plc:old' })).toBeNull()
    expect(
      await database.getBlueskyFollowTargetIds({ actorId: 'actor-3' })
    ).toEqual([])
    expect(
      (await database.getBlueskyAccount({ actorId: 'actor-3' }))?.did
    ).toBe('did:plc:new')
  })

  it('keeps the session and follows when the same DID is linked again', async () => {
    await link('actor-4', 'did:plc:same')
    await database.setBlueskySession({ did: 'did:plc:same', session: 's1' })
    await follow('actor-4')
    await link('actor-4', 'did:plc:same')
    expect(await database.getBlueskySession({ did: 'did:plc:same' })).toBe('s1')
    expect(
      await database.getBlueskyFollowTargetIds({ actorId: 'actor-4' })
    ).toHaveLength(1)
  })

  it('keeps the last sync and clears its error when the same DID is linked again', async () => {
    await link('actor-sync', 'did:plc:sync')
    await database.updateBlueskyAccountSync({
      actorId: 'actor-sync',
      lastSyncedAt: 1_700_000_000_000,
      syncError: 'Bluesky ended this session.'
    })
    expect(
      await database.getBlueskyAccount({ actorId: 'actor-sync' })
    ).toMatchObject({
      lastSyncedAt: 1_700_000_000_000,
      syncError: 'Bluesky ended this session.'
    })
    await link('actor-sync', 'did:plc:sync')
    expect(
      await database.getBlueskyAccount({ actorId: 'actor-sync' })
    ).toMatchObject({ lastSyncedAt: 1_700_000_000_000, syncError: null })
  })

  it('lists the linked accounts that still have a session to sync', async () => {
    const linked = async (username: string) => {
      const actor = await createAdmin(username)
      await link(actor.actorId, `did:plc:${username}`)
      await database.setBlueskySession({
        did: `did:plc:${username}`,
        session: 's'
      })
      return actor
    }
    const listed = await linked('sync-listed')
    // Confirmed: better-auth already treats the account as verified.
    const confirmed = await linked('sync-confirmed')
    await testDb.db
      .updateTable('accounts')
      .set({ verificationCode: 'code', emailVerified: true })
      .where('id', '=', confirmed.accountId)
      .execute()
    // No pending code, NULL or empty, also counts as confirmed, whatever
    // emailVerified says.
    const nullCode = await linked('sync-null-code')
    const emptyCode = await linked('sync-empty-code')
    for (const [{ accountId }, verificationCode] of [
      [nullCode, null],
      [emptyCode, '']
    ] as const) {
      await testDb.db
        .updateTable('accounts')
        .set({ verificationCode, emailVerified: false })
        .where('id', '=', accountId)
        .execute()
    }
    const noSession = await createAdmin('sync-no-session')
    await link(noSession.actorId, 'did:plc:sync-no-session')
    const suspended = await linked('sync-suspended')
    await testDb.db
      .updateTable('actors')
      .set({ suspendedAt: new Date() })
      .where('id', '=', suspended.actorId)
      .execute()
    const deleting = await linked('sync-deleting')
    await testDb.db
      .updateTable('actors')
      .set({ deletionStatus: 'scheduled' })
      .where('id', '=', deleting.actorId)
      .execute()
    const disabled = await linked('sync-disabled')
    await testDb.db
      .updateTable('accounts')
      .set({ disabledAt: new Date() })
      .where('id', '=', disabled.accountId)
      .execute()
    const unconfirmed = await linked('sync-unconfirmed')
    await testDb.db
      .updateTable('accounts')
      .set({ verificationCode: 'code', emailVerified: false })
      .where('id', '=', unconfirmed.accountId)
      .execute()

    const actorIds = await database.listBlueskyAccountsToSync()
    expect(actorIds).toContain(listed.actorId)
    expect(actorIds).toContain(confirmed.actorId)
    expect(actorIds).toContain(nullCode.actorId)
    expect(actorIds).toContain(emptyCode.actorId)
    for (const skipped of [
      noSession,
      suspended,
      deleting,
      disabled,
      unconfirmed
    ]) {
      expect(actorIds).not.toContain(skipped.actorId)
    }
  })

  it('lets one active admin actor at a time answer for a host', async () => {
    const five = await createAdmin('bsky-five')
    const six = await createAdmin('bsky-six')
    await link(five.actorId, 'did:plc:five')
    await link(six.actorId, 'did:plc:six')

    expect(
      await database.setBlueskyInstanceHandle({
        actorId: five.actorId,
        host: TEST_DOMAIN.toUpperCase()
      })
    ).toBe(true)
    expect(
      await database.setBlueskyInstanceHandle({
        actorId: six.actorId,
        host: TEST_DOMAIN
      })
    ).toBe(false)
    expect(
      await database.getBlueskyAccountByInstanceHandle({
        host: TEST_DOMAIN
      })
    ).toMatchObject({ actorId: five.actorId, did: 'did:plc:five' })

    // Re-linking the same DID keeps the claim.
    await link(five.actorId, 'did:plc:five')
    expect(
      (await database.getBlueskyAccount({ actorId: five.actorId }))
        ?.instanceHandle
    ).toBe(TEST_DOMAIN)

    // A holder who is no longer an admin answers nothing, and the claim can
    // be taken.
    await setRole(five.accountId, null)
    expect(
      await database.getBlueskyAccountByInstanceHandle({
        host: TEST_DOMAIN
      })
    ).toBeNull()
    expect(
      await database.setBlueskyInstanceHandle({
        actorId: six.actorId,
        host: TEST_DOMAIN
      })
    ).toBe(true)
    expect(
      await database.getBlueskyAccountByInstanceHandle({
        host: TEST_DOMAIN
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
        host: TEST_DOMAIN
      })
    ).toBeNull()
  })

  it('stops serving a claim whose account is disabled or actor suspended', async () => {
    const seven = await createAdmin('bsky-seven')
    await link(seven.actorId, 'did:plc:seven-claim')
    await database.setBlueskyInstanceHandle({
      actorId: seven.actorId,
      host: TEST_DOMAIN
    })
    const lookup = () =>
      database.getBlueskyAccountByInstanceHandle({ host: TEST_DOMAIN })
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

  it('stops serving a claim once its holder moves to another domain', async () => {
    const eight = await createAdmin('bsky-eight')
    await link(eight.actorId, 'did:plc:eight-claim')
    await database.setBlueskyInstanceHandle({
      actorId: eight.actorId,
      host: TEST_DOMAIN
    })
    expect(
      await database.getBlueskyAccountByInstanceHandle({ host: TEST_DOMAIN })
    ).toMatchObject({ actorId: eight.actorId })
    await testDb.db
      .updateTable('actors')
      .set({ domain: 'moved.example' })
      .where('id', '=', eight.actorId)
      .execute()
    expect(
      await database.getBlueskyAccountByInstanceHandle({ host: TEST_DOMAIN })
    ).toBeNull()
    // An admin still on the domain can take the claim over.
    const nine = await createAdmin('bsky-nine')
    await link(nine.actorId, 'did:plc:nine-claim')
    expect(
      await database.setBlueskyInstanceHandle({
        actorId: nine.actorId,
        host: TEST_DOMAIN
      })
    ).toBe(true)
    expect(
      (await database.getBlueskyAccount({ actorId: eight.actorId }))
        ?.instanceHandle
    ).toBeNull()
    await database.setBlueskyInstanceHandle({
      actorId: nine.actorId,
      host: null
    })
  })

  it('serves a claim whose holder’s domain row keeps an old spelling', async () => {
    const ten = await createAdmin('bsky-ten')
    await link(ten.actorId, 'did:plc:ten-claim')
    await testDb.db
      .updateTable('actors')
      .set({ domain: TEST_DOMAIN.toUpperCase() })
      .where('id', '=', ten.actorId)
      .execute()
    await database.setBlueskyInstanceHandle({
      actorId: ten.actorId,
      host: TEST_DOMAIN
    })
    expect(
      await database.getBlueskyAccountByInstanceHandle({ host: TEST_DOMAIN })
    ).toMatchObject({ actorId: ten.actorId })
    await database.setBlueskyInstanceHandle({
      actorId: ten.actorId,
      host: null
    })
  })

  it('unlinks the account, its session and its follows', async () => {
    await link('actor-7', 'did:plc:seven')
    await database.setBlueskySession({ did: 'did:plc:seven', session: 's' })
    await follow('actor-7')
    await database.deleteBlueskyAccount({ actorId: 'actor-7' })
    expect(await database.getBlueskyAccount({ actorId: 'actor-7' })).toBeNull()
    expect(
      await database.getBlueskyFollowTargetIds({ actorId: 'actor-7' })
    ).toEqual([])
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

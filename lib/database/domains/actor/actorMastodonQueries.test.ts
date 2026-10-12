import crypto from 'crypto'
import type { Insertable } from 'kysely'

import type { SQLActorDatabase } from '@/lib/database/domains/actor/types'
import type { Actors } from '@/lib/database/kysely/db'
import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'
import { CounterKey } from '@/lib/database/utils/counter'
import {
  FEDERATION_SIGNING_ACTOR_TYPE,
  FEDERATION_SIGNING_ACTOR_USERNAME,
  getFederationSigningActorId,
  getFederationSigningActorUsername
} from '@/lib/services/federation/instanceActor'
import { TEST_DOMAIN } from '@/lib/stub/const'

// The actor lookups that build Mastodon Account entities (getMastodonActors
// and the profile directory), the federation signing actor and the NodeInfo
// statistics, each `where`, `orderBy` and `limit` pinned with a neighbouring
// row the query must not touch. Runs on PostgreSQL in CI.

// The configured host (test/setup/vitest.setup.ts).
const LOCAL = TEST_DOMAIN
const REMOTE = 'actormq.remote.test'

const testDb = createTestDatabase()
// getMastodonActor(s) are on the SQL facade, not the Database interface.
const database = testDb.database as typeof testDb.database & SQLActorDatabase

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await database.destroy()
})

const suffix = () => crypto.randomUUID().slice(0, 8)

const insertActor = async (
  target: TestDatabase,
  label: string,
  values: Partial<Insertable<Actors>> = {}
) => {
  const username = values.username ?? `${label}-${suffix()}`
  const domain = values.domain ?? REMOTE
  const id = values.id ?? `https://${domain}/users/${username}`
  await target.db
    .insertInto('actors')
    .values({
      id,
      publicId: null,
      type: 'Person',
      username,
      domain,
      accountId: null,
      settings: JSON.stringify({
        followersUrl: `${id}/followers`,
        inboxUrl: `${id}/inbox`,
        sharedInboxUrl: `https://${domain}/inbox`
      }),
      publicKey: `public-${username}`,
      privateKey: null,
      createdAt: new Date(1_000_000),
      updatedAt: new Date(1_000_000),
      ...values
    })
    .execute()
  return id
}

const insertAccount = async (target: TestDatabase) => {
  const id = crypto.randomUUID()
  await target.db
    .insertInto('accounts')
    .values({ id, email: `${id}@actormq.test`, passwordHash: 'hash' })
    .execute()
  return id
}

const setCounter = (target: TestDatabase, id: string, value: number) =>
  target.db
    .insertInto('counters')
    .values({ id, value, createdAt: new Date(), updatedAt: new Date() })
    .onConflict((oc) => oc.column('id').doUpdateSet({ value }))
    .execute()

const counterValue = async (target: TestDatabase, id: string) =>
  (
    await target.db
      .selectFrom('counters')
      .select('value')
      .where('id', '=', id)
      .executeTakeFirst()
  )?.value

describe('getMastodonActors', () => {
  it('returns one account per requested id, in request order, with its own counters', async () => {
    const a = await insertActor(testDb, 'm-a')
    const b = await insertActor(testDb, 'm-b')
    const neighbour = await insertActor(testDb, 'm-n')
    await setCounter(testDb, CounterKey.totalFollowers(a), 2)
    await setCounter(testDb, CounterKey.totalFollowing(a), 3)
    await setCounter(testDb, CounterKey.totalStatus(a), 4)
    await setCounter(testDb, CounterKey.totalStatus(neighbour), 40)

    const accounts = await database.getMastodonActors([b, `${a}-missing`, a, b])
    expect(accounts.map((account) => account.url)).toEqual([b, a, b])
    expect(accounts[1]).toMatchObject({
      followers_count: 2,
      following_count: 3,
      statuses_count: 4
    })
    expect(accounts[0]).toMatchObject({
      followers_count: 0,
      following_count: 0,
      statuses_count: 0
    })
    expect(await database.getMastodonActors([])).toEqual([])
    expect(await database.getMastodonActor(`${a}-missing`)).toBeNull()
    expect((await database.getMastodonActorFromId({ id: a }))?.url).toBe(a)
    expect(
      (await database.getMastodonActorsFromIds({ ids: [b, a] })).map(
        (account) => account.url
      )
    ).toEqual([b, a])
  })

  it('maps the row to the Account entity', async () => {
    const id = await insertActor(testDb, 'm-map', {
      type: 'Service',
      username: 'Mapped',
      domain: 'Remote.Example.TEST',
      publicId: 'abcdef01-2345-7000-8000-000000000001',
      name: 'Display',
      summary: '<script>x</script>Bio',
      settings: JSON.stringify({
        followersUrl: 'f',
        inboxUrl: 'i',
        sharedInboxUrl: 's',
        iconUrl: 'https://img.test/a.png',
        fields: [{ name: 'Site', value: '<b>v</b>' }],
        tags: [{ type: 'emoji', name: ':wave:', value: 'https://img.test/w' }],
        manuallyApprovesFollowers: false
      }),
      lastStatusAt: new Date('2026-02-03T04:05:06.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      suspendedAt: new Date(0),
      silencedAt: new Date(5)
    })
    const account = await database.getMastodonActor(id)
    expect(account).toMatchObject({
      id: 'abcdef01-2345-7000-8000-000000000001',
      username: 'Mapped',
      acct: 'Mapped@remote.example.test',
      url: id,
      uri: id,
      display_name: 'Display',
      avatar: 'https://img.test/a.png',
      header: '',
      emojis: [
        expect.objectContaining({
          shortcode: 'wave',
          url: 'https://img.test/w'
        })
      ],
      suspended: true,
      limited: true,
      locked: false,
      bot: true,
      group: false,
      discoverable: true,
      noindex: false,
      created_at: '2026-01-01T00:00:00.000Z',
      last_status_at: '2026-02-03'
    })
    expect(account?.note).not.toContain('<script>')
    expect(account?.source.note).toBe('<script>x</script>Bio')
    expect(account?.source.fields).toEqual([
      { name: 'Site', value: '<b>v</b>', verified_at: null }
    ])

    // A local actor gets a bare acct, and no moderation flags when unset.
    const localId = await insertActor(testDb, 'm-local', {
      username: 'localmapped',
      domain: LOCAL
    })
    const local = await database.getMastodonActor(localId)
    expect(local).toMatchObject({ acct: 'localmapped', locked: true })
    expect(local).not.toHaveProperty('suspended')
    expect(local).not.toHaveProperty('limited')
    expect(local?.last_status_at).toBeNull()
  })
})

describe('getLocalMastodonActors', () => {
  const usernames = (accounts: { url: string }[], ids: string[]) =>
    accounts.map((account) => account.url).filter((url) => ids.includes(url))

  it('lists only account-backed actors on the local domain, never suspended or silenced ones', async () => {
    const domain = `dir-${suffix()}.test`
    const accountId = await insertAccount(testDb)
    const listed = await insertActor(testDb, 'dir-listed', {
      domain,
      accountId
    })
    await insertActor(testDb, 'dir-noaccount', { domain })
    await insertActor(testDb, 'dir-elsewhere', {
      accountId: await insertAccount(testDb)
    })
    await insertActor(testDb, 'dir-suspended', {
      domain,
      accountId: await insertAccount(testDb),
      suspendedAt: new Date(10)
    })
    await insertActor(testDb, 'dir-silenced', {
      domain,
      accountId: await insertAccount(testDb),
      silencedAt: new Date(10)
    })

    const accounts = await database.getLocalMastodonActors({
      localDomain: `https://${domain}`
    })
    expect(accounts.map((account) => account.url)).toEqual([listed])
  })

  it('lists every known actor except the local ones without an account when local=false', async () => {
    const domain = `dirall-${suffix()}.test`
    const localWithAccount = await insertActor(testDb, 'all-local', {
      domain,
      accountId: await insertAccount(testDb)
    })
    const localSigner = await insertActor(testDb, 'all-signer', { domain })
    const remote = await insertActor(testDb, 'all-remote')
    const remoteSuspended = await insertActor(testDb, 'all-suspended', {
      suspendedAt: new Date(10)
    })
    const remoteSilenced = await insertActor(testDb, 'all-silenced', {
      silencedAt: new Date(10)
    })

    const ids = [
      localWithAccount,
      localSigner,
      remote,
      remoteSuspended,
      remoteSilenced
    ]
    const accounts = await database.getLocalMastodonActors({
      localDomain: domain,
      local: false,
      order: 'new',
      limit: 1000
    })
    expect(usernames(accounts, ids).sort()).toEqual(
      [localWithAccount, remote].sort()
    )
  })

  it('orders active profiles by their last status, never-posted last, then newest', async () => {
    const domain = `dirord-${suffix()}.test`
    const add = async (
      label: string,
      lastStatusAt: number | null,
      createdAt: number
    ) =>
      insertActor(testDb, label, {
        domain,
        accountId: await insertAccount(testDb),
        lastStatusAt: lastStatusAt === null ? null : new Date(lastStatusAt),
        createdAt: new Date(createdAt)
      })
    const olderTie = await add('ord-a', 300_000, 1000)
    const posted = await add('ord-b', 200_000, 5000)
    const never = await add('ord-c', null, 9000)
    const neverOlder = await add('ord-d', null, 2000)
    const newerTie = await add('ord-e', 300_000, 3000)

    const active = await database.getLocalMastodonActors({
      localDomain: domain,
      order: 'active'
    })
    expect(active.map((account) => account.url)).toEqual([
      newerTie,
      olderTie,
      posted,
      never,
      neverOlder
    ])
    const newest = await database.getLocalMastodonActors({
      localDomain: domain,
      order: 'new'
    })
    expect(newest.map((account) => account.url)).toEqual([
      never,
      posted,
      newerTie,
      neverOlder,
      olderTie
    ])
    const page = await database.getLocalMastodonActors({
      localDomain: domain,
      order: 'new',
      limit: 2,
      offset: 1
    })
    expect(page.map((account) => account.url)).toEqual([posted, newerTie])
  })
})

describe('getFederationSigningActor', () => {
  // Each test needs a database with no signer yet: the signer lives on the
  // configured host, which every test shares.
  const withFreshDatabase = async (
    test: (fresh: TestDatabase) => Promise<void>
  ) => {
    const fresh = createTestDatabase({ isolated: true })
    await fresh.prepare()
    await fresh.database.migrate()
    try {
      await test(fresh)
    } finally {
      await fresh.destroy()
    }
  }

  const signerValues = (username: string, createdAt: number) => ({
    id: getFederationSigningActorId(LOCAL, username),
    username,
    domain: LOCAL,
    type: FEDERATION_SIGNING_ACTOR_TYPE,
    privateKey: `private-${username}`,
    createdAt: new Date(createdAt)
  })

  it('adopts the oldest existing headless signer, then the lowest id', async () => {
    await withFreshDatabase(async (fresh) => {
      // The reserved id holds a row that is not a valid signer.
      await insertActor(fresh, 'reserved', {
        ...signerValues(FEDERATION_SIGNING_ACTOR_USERNAME, 100),
        privateKey: ''
      })
      // Newer, though its id sorts first.
      await insertActor(fresh, 'newer', signerValues('__instance__0', 300))
      await insertActor(fresh, 'tie-high', signerValues('__instance__z', 200))
      const tieLow = await insertActor(
        fresh,
        'tie-low',
        signerValues('__instance__a', 200)
      )

      expect((await fresh.database.getFederationSigningActor())?.id).toBe(
        tieLow
      )
    })
  })

  it('mints the next free signer name on its own domain', async () => {
    await withFreshDatabase(async (fresh) => {
      // Taken on this domain, by rows that cannot sign.
      await insertActor(fresh, 'taken', {
        ...signerValues(FEDERATION_SIGNING_ACTOR_USERNAME, 100),
        accountId: await insertAccount(fresh)
      })
      // Free names on this domain, taken on another one.
      await insertActor(fresh, 'other-domain', {
        ...signerValues(getFederationSigningActorUsername(1), 100),
        id: `https://other.test/users/${getFederationSigningActorUsername(1)}`,
        domain: 'other.test'
      })

      const signer = await fresh.database.getFederationSigningActor()
      expect(signer).toMatchObject({
        id: getFederationSigningActorId(
          LOCAL,
          getFederationSigningActorUsername(1)
        ),
        username: getFederationSigningActorUsername(1),
        privateKey: expect.any(String)
      })
      expect(signer?.account).toBeUndefined()
      // Asking again returns the same signer instead of minting another.
      expect((await fresh.database.getFederationSigningActor())?.id).toBe(
        signer?.id
      )
    })
  })
})

describe('getNodeInfoStats', () => {
  const NOW = Date.parse('2100-01-01T00:00:00.000Z')
  const DAY = 24 * 60 * 60 * 1000

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const insertStatus = (actorId: string, createdAt: number) =>
    testDb.db
      .insertInto('statuses')
      .values({
        id: `${actorId}/statuses/${suffix()}`,
        actorId,
        type: 'Note',
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt)
      })
      .execute()

  it('counts the account-backed actors that posted in the last month and half year, cached for an hour', async () => {
    const monthly = await insertActor(testDb, 'ni-month', {
      accountId: await insertAccount(testDb)
    })
    const halfYearly = await insertActor(testDb, 'ni-half', {
      accountId: await insertAccount(testDb)
    })
    const lapsed = await insertActor(testDb, 'ni-lapsed', {
      accountId: await insertAccount(testDb)
    })
    const remote = await insertActor(testDb, 'ni-remote')
    await insertStatus(monthly, NOW - 10 * DAY)
    await insertStatus(monthly, NOW - 20 * DAY)
    await insertStatus(monthly, NOW - 100 * DAY)
    await insertStatus(halfYearly, NOW - 31 * DAY)
    await insertStatus(lapsed, NOW - 181 * DAY)
    await insertStatus(remote, NOW - 1 * DAY)
    await setCounter(testDb, CounterKey.nodeinfoTotalUsers(), 5)
    await setCounter(testDb, CounterKey.nodeinfoLocalPosts(), 6)
    await setCounter(testDb, CounterKey.nodeinfoComputedAt(), 0)

    const expected = {
      totalUsers: 5,
      localPosts: 6,
      activeMonth: 1,
      activeHalfyear: 2
    }
    expect(await database.getNodeInfoStats()).toEqual(expected)
    expect(await counterValue(testDb, CounterKey.nodeinfoActiveMonth())).toBe(1)
    expect(
      await counterValue(testDb, CounterKey.nodeinfoActiveHalfyear())
    ).toBe(2)
    expect(await counterValue(testDb, CounterKey.nodeinfoComputedAt())).toBe(
      NOW / 1000
    )

    // Within the hour the cached counts are served, even when stale.
    await insertStatus(lapsed, NOW - DAY)
    vi.setSystemTime(NOW + 3600 * 1000)
    expect(await database.getNodeInfoStats()).toEqual(expected)

    // After it, they are recomputed.
    vi.setSystemTime(NOW + 3601 * 1000)
    expect(await database.getNodeInfoStats()).toEqual({
      ...expected,
      activeMonth: 2,
      activeHalfyear: 3
    })
  })
})

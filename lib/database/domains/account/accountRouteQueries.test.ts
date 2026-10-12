import crypto from 'crypto'
import { sql } from 'kysely'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

// The two account reads and writes the actor switch and passkey list routes
// make: pointing a session at another actor, and listing an account's
// passkeys. Each runs against a neighbouring session or account it must not
// touch, and the passkey list is pinned for the representation the route used
// to normalise itself (a boolean `backedUp`, `createdAt` as epoch milliseconds
// on both backends). Runs on PostgreSQL in CI.

const testDb = createTestDatabase()
const { database } = testDb
const db = () => testDb.db
const isSqlite = () => testDb.backend === 'sqlite'

const DOMAIN = 'account-route.test'

const newAccount = async (label: string) => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const username = `${label}-${suffix}`
  return database.createAccount({
    email: `${username}@${DOMAIN}`,
    username,
    passwordHash: `hash-${username}`,
    domain: DOMAIN,
    privateKey: `private-${username}`,
    publicKey: `public-${username}`
  })
}

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await database.destroy()
})

describe('setSessionActorIdByToken', () => {
  const sessionRow = (token: string) =>
    db()
      .selectFrom('sessions')
      .selectAll()
      .where('token', '=', token)
      .executeTakeFirstOrThrow()

  it('points the session with that token at the actor and touches no other session', async () => {
    const accountId = await newAccount('switcher')
    const expireAt = Date.now() + 86_400_000
    await database.createAccountSession({
      accountId,
      token: 'switch-token',
      expireAt,
      actorId: 'https://account-route.test/users/first'
    })
    await database.createAccountSession({
      accountId,
      token: 'neighbour-token',
      expireAt,
      actorId: 'https://account-route.test/users/first'
    })
    const before = await sessionRow('switch-token')

    const updated = await database.setSessionActorIdByToken({
      token: 'switch-token',
      actorId: 'https://account-route.test/users/second'
    })

    expect(updated).toBe(1)
    expect(await sessionRow('switch-token')).toEqual({
      ...before,
      actorId: 'https://account-route.test/users/second'
    })
    expect((await sessionRow('neighbour-token')).actorId).toBe(
      'https://account-route.test/users/first'
    )
  })

  it('sets the actor of a session that had none', async () => {
    const accountId = await newAccount('no-actor')
    await database.createAccountSession({
      accountId,
      token: 'no-actor-token',
      expireAt: Date.now() + 86_400_000
    })

    await expect(
      database.setSessionActorIdByToken({
        token: 'no-actor-token',
        actorId: 'https://account-route.test/users/chosen'
      })
    ).resolves.toBe(1)

    expect((await sessionRow('no-actor-token')).actorId).toBe(
      'https://account-route.test/users/chosen'
    )
  })

  it('updates nothing for a token no session has', async () => {
    const accountId = await newAccount('unknown-token')
    await database.createAccountSession({
      accountId,
      token: 'known-token',
      expireAt: Date.now() + 86_400_000,
      actorId: 'https://account-route.test/users/kept'
    })

    await expect(
      database.setSessionActorIdByToken({
        token: 'unknown-token',
        actorId: 'https://account-route.test/users/other'
      })
    ).resolves.toBe(0)

    expect((await sessionRow('known-token')).actorId).toBe(
      'https://account-route.test/users/kept'
    )
  })
})

describe('getAccountPasskeys', () => {
  const addPasskey = (
    id: string,
    userId: string,
    {
      name = null,
      rpID = null,
      deviceType = 'singleDevice',
      backedUp = false,
      aaguid = null,
      createdAt
    }: {
      name?: string | null
      rpID?: string | null
      deviceType?: string
      backedUp?: boolean
      aaguid?: string | null
      createdAt?: Date
    } = {}
  ) =>
    db()
      .insertInto('passkey')
      .values({
        id,
        name,
        publicKey: `public-key-${id}`,
        userId,
        credentialID: `credential-${id}`,
        deviceType,
        backedUp,
        transports: 'internal',
        aaguid,
        rpID,
        ...(createdAt ? { createdAt } : {})
      })
      .execute()

  it('lists the account’s passkeys oldest first, without the key material', async () => {
    const accountId = await newAccount('passkeys')
    const neighbourId = await newAccount('passkeys-neighbour')
    await addPasskey('newest', accountId, {
      name: 'Phone',
      rpID: 'second.example',
      deviceType: 'multiDevice',
      backedUp: true,
      aaguid: 'aaguid-1',
      createdAt: new Date('2026-06-01T10:11:12.000Z')
    })
    await addPasskey('oldest', accountId, {
      createdAt: new Date('2026-04-12T00:00:00.000Z')
    })
    await addPasskey('neighbour', neighbourId, {
      createdAt: new Date('2026-05-01T00:00:00.000Z')
    })

    const passkeys = await database.getAccountPasskeys({ accountId })

    expect(passkeys).toEqual([
      {
        id: 'oldest',
        name: null,
        rpID: null,
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: Date.parse('2026-04-12T00:00:00.000Z'),
        aaguid: null
      },
      {
        id: 'newest',
        name: 'Phone',
        rpID: 'second.example',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: Date.parse('2026-06-01T10:11:12.000Z'),
        aaguid: 'aaguid-1'
      }
    ])
    expect(passkeys.map((passkey) => Object.keys(passkey).sort())).toEqual([
      ['aaguid', 'backedUp', 'createdAt', 'deviceType', 'id', 'name', 'rpID'],
      ['aaguid', 'backedUp', 'createdAt', 'deviceType', 'id', 'name', 'rpID']
    ])
  })

  it('reads `backedUp` as a boolean and `createdAt` as a number on both backends', async () => {
    const accountId = await newAccount('passkey-types')
    await addPasskey('synced', accountId, {
      backedUp: true,
      createdAt: new Date('2026-04-01T00:00:00.000Z')
    })
    await addPasskey('device-bound', accountId, {
      backedUp: false,
      createdAt: new Date('2026-04-02T00:00:00.000Z')
    })

    const [synced, deviceBound] = await database.getAccountPasskeys({
      accountId
    })

    expect(synced.backedUp).toBe(true)
    expect(deviceBound.backedUp).toBe(false)
    expect(typeof synced.createdAt).toBe('number')
  })

  it('answers an empty list for an account with no passkey', async () => {
    const accountId = await newAccount('no-passkeys')

    await expect(database.getAccountPasskeys({ accountId })).resolves.toEqual(
      []
    )
  })

  it('gives a passkey stored without a createdAt the database default, a moment ago', async () => {
    const accountId = await newAccount('default-created-at')
    const before = Date.now()
    await addPasskey('defaulted', accountId)
    const after = Date.now()

    const [passkey] = await database.getAccountPasskeys({ accountId })

    // SQLite's CURRENT_TIMESTAMP has whole-second precision.
    expect(passkey.createdAt).toBeGreaterThanOrEqual(
      Math.floor(before / 1000) * 1000
    )
    expect(passkey.createdAt).toBeLessThanOrEqual(after)
  })

  it.runIf(isSqlite())(
    'reads a SQLite createdAt stored as zone-less UTC text or as epoch milliseconds the same way',
    async () => {
      const accountId = await newAccount('sqlite-created-at')
      await addPasskey('as-text', accountId)
      await addPasskey('as-number', accountId)
      await addPasskey('with-fraction', accountId)
      await addPasskey('not-a-date', accountId)
      await sql`update "passkey" set "createdAt" = '2026-04-12 08:09:10' where "id" = 'as-text'`.execute(
        db()
      )
      await sql`update "passkey" set "createdAt" = ${Date.UTC(2026, 3, 13, 8, 9, 10)} where "id" = 'as-number'`.execute(
        db()
      )
      await sql`update "passkey" set "createdAt" = '2026-04-14 08:09:10.250' where "id" = 'with-fraction'`.execute(
        db()
      )
      await sql`update "passkey" set "createdAt" = 'not a date' where "id" = 'not-a-date'`.execute(
        db()
      )

      const passkeys = await database.getAccountPasskeys({ accountId })

      // Compared by id: SQLite sorts the integer before the text, so the
      // order of a mixed table is not the order of the instants.
      const createdAtById = Object.fromEntries(
        passkeys.map(({ id, createdAt }) => [id, createdAt])
      )
      expect(createdAtById).toMatchObject({
        'as-text': Date.UTC(2026, 3, 12, 8, 9, 10),
        'as-number': Date.UTC(2026, 3, 13, 8, 9, 10),
        'with-fraction': Date.UTC(2026, 3, 14, 8, 9, 10, 250)
      })
      // A stored value that is not a date is NaN here, which the route
      // reports as a null createdAt (see app/api/v1/passkeys/route.test.ts).
      expect(Number.isNaN(createdAtById['not-a-date'])).toBe(true)
    }
  )
})

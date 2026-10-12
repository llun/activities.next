import type { TestDatabase } from '@/lib/database/testing/createTestDatabase'

import { type AuthKysely, kyselyAdapter } from './kyselyAdapter'
import {
  type TestAdapter,
  createTestDatabase,
  resetTables
} from './kyselyAdapter.testUtils'

vi.mock('better-auth/adapters', () => import('./kyselyAdapter.testFactory'))

describe('kyselyAdapter', () => {
  let testDb: TestDatabase
  let db: AuthKysely
  let adapter: TestAdapter

  beforeAll(async () => {
    ;({ testDb, db, adapter } = await createTestDatabase())
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  beforeEach(async () => {
    await resetTables(db)
  })

  const findRow = (table: string, id: string) =>
    db.selectFrom(table).selectAll().where('id', '=', id).executeTakeFirst()

  const countRows = async (table: string) =>
    (await db.selectFrom(table).selectAll().execute()).length

  // The SQL of every statement `run` issues.
  const captureStatements = async (run: () => Promise<unknown>) =>
    (await testDb.captureQueries(run)).map(({ sql }) => sql)

  describe('passkey rpID stamping', () => {
    it('stamps the instance rpID onto a new passkey row', async () => {
      const adapterWithRpID = kyselyAdapter(db, {
        passkeyRpID: 'social.example'
      })({} as any)

      await adapterWithRpID.create({
        model: 'passkey',
        data: { id: 'pk1', userId: 'u1' }
      })

      const row = await findRow('passkey', 'pk1')
      expect(row?.rpID).toBe('social.example')
    })

    it('does not overwrite an rpID already present in the data', async () => {
      const adapterWithRpID = kyselyAdapter(db, {
        passkeyRpID: 'social.example'
      })({} as any)

      await adapterWithRpID.create({
        model: 'passkey',
        data: { id: 'pk2', userId: 'u1', rpID: 'photos.example' }
      })

      const row = await findRow('passkey', 'pk2')
      expect(row?.rpID).toBe('photos.example')
    })

    it('leaves rpID null when the adapter has no configured rpID', async () => {
      await adapter.create({
        model: 'passkey',
        data: { id: 'pk3', userId: 'u1' }
      })

      const row = await findRow('passkey', 'pk3')
      expect(row?.rpID).toBeNull()
    })
  })

  // better-auth 1.7.3 can synthesize guarded fallbacks for these two atomic
  // primitives, but this adapter keeps native implementations so the database
  // performs each guarded mutation directly. The fallback is safe only when
  // deleteMany/updateMany apply the supplied guard atomically and report the
  // exact affected-row count.
  describe('consumeOne', () => {
    beforeEach(async () => {
      await db
        .insertInto('users')
        .values([
          { id: 'u1', display_name: 'Alice', email: 'alice@test.com' },
          { id: 'u2', display_name: 'Bob', email: 'bob@test.com' }
        ])
        .execute()
    })

    it('deletes the matching row and returns it', async () => {
      const row = await adapter.consumeOne<{ id: string; email: string }>({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }]
      })

      expect(row?.id).toBe('u1')
      expect(row?.email).toBe('alice@test.com')
      expect(await findRow('users', 'u1')).toBeUndefined()
      expect(await findRow('users', 'u2')).toBeDefined()
    })

    it('returns null when nothing matches', async () => {
      const row = await adapter.consumeOne({
        model: 'users',
        where: [{ field: 'id', value: 'missing', operator: 'eq' as const }]
      })

      expect(row).toBeNull()
      expect(await countRows('users')).toBe(2)
    })

    it('deletes at most one row for a predicate matching several', async () => {
      const row = await adapter.consumeOne<{ id: string }>({
        model: 'users',
        where: [{ field: 'id', value: ['u1', 'u2'], operator: 'in' as const }]
      })

      expect(['u1', 'u2']).toContain(row?.id)
      expect(await countRows('users')).toBe(1)
    })

    // The single-use guarantee: better-auth consumes verification tokens and
    // authorization codes through this, so of N callers racing for one row
    // exactly one may come away with it.
    it('hands the row to exactly one of several concurrent callers', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          adapter.consumeOne<{ id: string }>({
            model: 'users',
            where: [{ field: 'id', value: 'u1', operator: 'eq' as const }]
          })
        )
      )

      expect(results.filter((result) => result !== null)).toHaveLength(1)
      expect(await findRow('users', 'u1')).toBeUndefined()
    })

    // The behavioural tests above pass whether or not the DELETE re-applies the
    // caller's predicate, because nothing in a single-threaded test changes the
    // row between the read and the delete. The race safety comes entirely from
    // that re-application — a racing caller re-evaluates it after the winner
    // commits — so the statement's shape is what has to be pinned.
    it('re-applies the caller predicate in the DELETE, not just the row id', async () => {
      const statements = await captureStatements(() =>
        adapter.consumeOne({
          model: 'users',
          where: [
            { field: 'id', value: 'u1', operator: 'eq' as const },
            { field: 'email', value: 'alice@test.com', operator: 'eq' as const }
          ]
        })
      )

      const deletes = statements.filter((sql) => sql.startsWith('delete'))
      expect(deletes).toHaveLength(1)
      expect(deletes[0]).toContain('email')
    })

    it('returns null rather than consuming an arbitrary row for an empty predicate', async () => {
      const row = await adapter.consumeOne({ model: 'users', where: [] })

      expect(row).toBeNull()
      expect(await countRows('users')).toBe(2)
    })

    it('hydrates date columns on the returned row', async () => {
      const createdAt = new Date('2026-02-03T04:05:06.000Z')
      await db.insertInto('users').values({ id: 'u3', createdAt }).execute()

      const row = await adapter.consumeOne<{ createdAt: Date }>({
        model: 'users',
        where: [{ field: 'id', value: 'u3', operator: 'eq' as const }]
      })

      expect(row?.createdAt).toBeInstanceOf(Date)
      expect(row?.createdAt.toISOString()).toBe(createdAt.toISOString())
    })
  })

  describe('incrementOne', () => {
    beforeEach(async () => {
      await db
        .insertInto('counters')
        .values([
          { id: 'c1', value: 5 },
          { id: 'c2', value: 0 }
        ])
        .execute()
    })

    const counterValue = async (id: string) =>
      (await findRow('counters', id))?.value

    it('applies the delta and returns the updated row', async () => {
      const row = await adapter.incrementOne<{ id: string; value: number }>({
        model: 'counters',
        where: [{ field: 'id', value: 'c1', operator: 'eq' as const }],
        increment: { value: 3 }
      })

      expect(row?.value).toBe(8)
      expect(await counterValue('c1')).toBe(8)
    })

    it('decrements on a negative delta', async () => {
      const row = await adapter.incrementOne<{ value: number }>({
        model: 'counters',
        where: [{ field: 'id', value: 'c1', operator: 'eq' as const }],
        increment: { value: -2 }
      })

      expect(row?.value).toBe(3)
    })

    it('assigns `set` fields in the same statement as the increment', async () => {
      const updatedAt = new Date('2026-02-03T04:00:00.000Z')
      const row = await adapter.incrementOne<{
        value: number
        updatedAt: Date
      }>({
        model: 'counters',
        where: [{ field: 'id', value: 'c1', operator: 'eq' as const }],
        increment: { value: 1 },
        set: { updatedAt }
      })

      expect(row?.value).toBe(6)
      expect(row?.updatedAt).toBeInstanceOf(Date)
      expect(row?.updatedAt.toISOString()).toBe(updatedAt.toISOString())
    })

    // The `where` is the guard as well as the selector — this is what lets
    // better-auth decrement a remaining-uses counter only while it is positive.
    it('makes no change and returns null when the guard does not hold', async () => {
      const row = await adapter.incrementOne({
        model: 'counters',
        where: [
          { field: 'id', value: 'c2', operator: 'eq' as const },
          { field: 'value', value: 0, operator: 'gt' as const }
        ],
        increment: { value: -1 }
      })

      expect(row).toBeNull()
      expect(await counterValue('c2')).toBe(0)
    })

    it('returns null when nothing matches', async () => {
      const row = await adapter.incrementOne({
        model: 'counters',
        where: [{ field: 'id', value: 'missing', operator: 'eq' as const }],
        increment: { value: 1 }
      })

      expect(row).toBeNull()
    })

    // better-auth guards refresh-token rotation and revocation with
    // `{ field: 'revoked', operator: 'eq', value: null }` — "not revoked yet".
    // Rendered literally that is `revoked = NULL`, which matches nothing on
    // either backend, so every rotation would report an invalid refresh token.
    it('treats an eq null guard as IS NULL rather than = NULL', async () => {
      await db
        .insertInto('counters')
        .values({ id: 'c3', value: 1, bucketHour: null })
        .execute()

      const row = await adapter.incrementOne<{ id: string; value: number }>({
        model: 'counters',
        where: [
          { field: 'id', value: 'c3', operator: 'eq' as const },
          { field: 'bucketHour', value: null, operator: 'eq' as const }
        ],
        increment: { value: 1 }
      })

      expect(row?.value).toBe(2)
    })

    it('treats a ne null guard as IS NOT NULL', async () => {
      await db
        .insertInto('counters')
        .values({ id: 'c4', value: 1, bucketHour: null })
        .execute()

      const unset = await adapter.incrementOne({
        model: 'counters',
        where: [
          { field: 'id', value: 'c4', operator: 'eq' as const },
          { field: 'bucketHour', value: null, operator: 'ne' as const }
        ],
        increment: { value: 1 }
      })
      expect(unset).toBeNull()

      await db
        .updateTable('counters')
        .set({ bucketHour: new Date('2026-02-03T04:00:00.000Z') })
        .where('id', '=', 'c4')
        .execute()
      const set = await adapter.incrementOne<{ value: number }>({
        model: 'counters',
        where: [
          { field: 'id', value: 'c4', operator: 'eq' as const },
          { field: 'bucketHour', value: null, operator: 'ne' as const }
        ],
        increment: { value: 1 }
      })
      expect(set?.value).toBe(2)
    })

    it('updates at most one row for a predicate matching several', async () => {
      await adapter.incrementOne({
        model: 'counters',
        where: [{ field: 'id', value: ['c1', 'c2'], operator: 'in' as const }],
        increment: { value: 10 }
      })

      const values = (
        await db.selectFrom('counters').select('value').orderBy('id').execute()
      ).map((row: { value: number }) => row.value)
      expect(values.filter((value) => value >= 10)).toHaveLength(1)
    })

    // Same reasoning as consumeOne's: the guard only does anything under a
    // concurrent write, so pin that it reaches the UPDATE rather than being
    // spent on the id lookup alone.
    it('re-applies the caller predicate in the UPDATE, not just the row id', async () => {
      const statements = await captureStatements(() =>
        adapter.incrementOne({
          model: 'counters',
          where: [
            { field: 'id', value: 'c1', operator: 'eq' as const },
            { field: 'value', value: 0, operator: 'gt' as const }
          ],
          increment: { value: 1 }
        })
      )

      const updates = statements.filter((sql) => sql.startsWith('update'))
      expect(updates).toHaveLength(1)
      expect(updates[0]).toContain('"value" >')
    })

    it('returns null rather than mutating an arbitrary row for an empty predicate', async () => {
      const row = await adapter.incrementOne({
        model: 'counters',
        where: [],
        increment: { value: 1 }
      })

      expect(row).toBeNull()
      expect(await counterValue('c1')).toBe(5)
    })

    // An `OR`-connected predicate is emitted as an OR group, which would
    // re-associate against the primary-key clause that bounds the statement to
    // one row if it were not parenthesised, and let it mutate a row the caller
    // never selected.
    it('keeps an OR predicate grouped away from the row it is bounded to', async () => {
      const row = await adapter.incrementOne<{ id: string; value: number }>({
        model: 'counters',
        where: [
          { field: 'id', value: 'c1', operator: 'eq' as const },
          {
            field: 'id',
            value: 'c2',
            operator: 'eq' as const,
            connector: 'OR' as const
          }
        ],
        increment: { value: 1 }
      })

      expect(row).not.toBeNull()
      const rows = await db
        .selectFrom('counters')
        .select(['id', 'value'])
        .orderBy('id')
        .execute()
      const changed = rows.filter(
        (entry: { id: string; value: number }) =>
          entry.value !== (entry.id === 'c1' ? 5 : 0)
      )
      expect(changed).toHaveLength(1)
    })
  })

  // Deleting a session that minted OAuth tokens trips the
  // oauthAccessToken/oauthRefreshToken sessionId foreign keys (no ON DELETE
  // action) — on PostgreSQL always, on SQLite with enforcement on, which is
  // better-sqlite3's default. The adapter is what better-auth calls for
  // sign-out and session cleanup, so it must detach those tokens first.
  describe('session deletion detaches OAuth tokens', () => {
    const seedSessionWithTokens = async (token: string) => {
      const sessionId = `sid-${token}`
      await db.insertInto('sessions').values({ id: sessionId, token }).execute()
      await db
        .insertInto('oauthAccessToken')
        .values({ id: `at-${token}`, sessionId })
        .execute()
      await db
        .insertInto('oauthRefreshToken')
        .values({ id: `rt-${token}`, sessionId })
        .execute()
    }

    const sessionByToken = (token: string) =>
      db
        .selectFrom('sessions')
        .selectAll()
        .where('token', '=', token)
        .executeTakeFirst()

    it('delete() detaches OAuth tokens before removing the session', async () => {
      await seedSessionWithTokens('signout-token')

      // Guard against a vacuous test: the plain delete must fail on the
      // foreign key, or the adapter's would pass without detaching anything.
      await expect(
        db
          .transaction()
          .execute((trx) =>
            trx
              .deleteFrom('sessions')
              .where('token', '=', 'signout-token')
              .execute()
          )
      ).rejects.toThrow(/foreign key/i)

      await expect(
        adapter.delete({
          model: 'sessions',
          where: [
            { field: 'token', value: 'signout-token', operator: 'eq' as const }
          ]
        })
      ).resolves.toBeUndefined()

      expect(await sessionByToken('signout-token')).toBeUndefined()
      expect(
        (await findRow('oauthAccessToken', 'at-signout-token'))?.sessionId
      ).toBeNull()
      expect(
        (await findRow('oauthRefreshToken', 'rt-signout-token'))?.sessionId
      ).toBeNull()
    })

    it('deleteMany() detaches a mixed batch and returns the deleted count', async () => {
      // bulk-a minted OAuth tokens; bulk-b did not. The realistic "revoke all
      // other sessions" case is a mix, and both must be deleted.
      await seedSessionWithTokens('bulk-a')
      await db
        .insertInto('sessions')
        .values({ id: 'sid-bulk-b', token: 'bulk-b' })
        .execute()

      const count = await adapter.deleteMany({
        model: 'sessions',
        where: [
          {
            field: 'token',
            value: ['bulk-a', 'bulk-b'],
            operator: 'in' as const
          }
        ]
      })

      expect(count).toBe(2)
      expect(await countRows('sessions')).toBe(0)
      // bulk-a's tokens must SURVIVE (not be deleted), detached from the
      // now-deleted session — asserting existence + null sessionId, not just
      // the absence of non-null links.
      const access = await findRow('oauthAccessToken', 'at-bulk-a')
      const refresh = await findRow('oauthRefreshToken', 'rt-bulk-a')
      expect(access).toBeDefined()
      expect(access?.sessionId).toBeNull()
      expect(refresh).toBeDefined()
      expect(refresh?.sessionId).toBeNull()
    })

    it('deleteMany() is a no-op returning 0 when no session matches', async () => {
      await seedSessionWithTokens('survivor')

      const count = await adapter.deleteMany({
        model: 'sessions',
        where: [{ field: 'token', value: 'missing', operator: 'eq' as const }]
      })

      expect(count).toBe(0)
      // The unrelated session and its (still-attached) tokens are untouched.
      expect(await sessionByToken('survivor')).toBeDefined()
      expect(
        (await findRow('oauthAccessToken', 'at-survivor'))?.sessionId
      ).toBe('sid-survivor')
    })

    it('consumeOne() detaches the tokens of the session it consumes', async () => {
      await seedSessionWithTokens('consumed')

      const row = await adapter.consumeOne<{ id: string }>({
        model: 'sessions',
        where: [{ field: 'token', value: 'consumed', operator: 'eq' as const }]
      })

      expect(row?.id).toBe('sid-consumed')
      expect(await sessionByToken('consumed')).toBeUndefined()
      expect(
        (await findRow('oauthAccessToken', 'at-consumed'))?.sessionId
      ).toBeNull()
    })
  })

  // Better-auth resolves sign-in/sign-up by email through this adapter against
  // the `accounts` (user) table, so the adapter must normalize `accounts.email`
  // on both writes and lookups to keep auth case-insensitive.
  describe('accounts email normalization', () => {
    const accountEmail = async (id: string) =>
      (await findRow('accounts', id))?.email

    it('lowercases the email when creating an account', async () => {
      await adapter.create({
        model: 'accounts',
        data: { id: 'a1', email: 'User.Name@Example.COM' }
      })
      expect(await accountEmail('a1')).toBe('user.name@example.com')
    })

    it.each([
      { description: 'an uppercase eq lookup', value: 'USER@EXAMPLE.COM' },
      { description: 'a mixed-case eq lookup', value: 'User@Example.com' }
    ])('finds an account by $description', async ({ value }) => {
      await db
        .insertInto('accounts')
        .values({ id: 'a1', email: 'user@example.com' })
        .execute()
      const result = await adapter.findOne({
        model: 'accounts',
        where: [{ field: 'email', value, operator: 'eq' as const }]
      })
      expect(result).toMatchObject({ id: 'a1' })
    })

    it('normalizes each entry of an IN lookup on email', async () => {
      await db
        .insertInto('accounts')
        .values({ id: 'a1', email: 'user@example.com' })
        .execute()
      const results = await adapter.findMany({
        model: 'accounts',
        where: [
          {
            field: 'email',
            value: ['Missing@Example.com', 'USER@EXAMPLE.COM'],
            operator: 'in' as const
          }
        ]
      })
      expect(results.map((r: any) => r.id)).toEqual(['a1'])
    })

    it('lowercases the email when updating an account', async () => {
      await db
        .insertInto('accounts')
        .values({ id: 'a1', email: 'user@example.com' })
        .execute()
      await adapter.update({
        model: 'accounts',
        where: [{ field: 'id', value: 'a1', operator: 'eq' as const }],
        update: { email: 'New.Address@Example.COM' }
      })
      expect(await accountEmail('a1')).toBe('new.address@example.com')
    })

    it('lowercases the email when updating many accounts', async () => {
      await db
        .insertInto('accounts')
        .values({ id: 'a1', email: 'user@example.com' })
        .execute()
      await adapter.updateMany({
        model: 'accounts',
        where: [{ field: 'id', value: 'a1', operator: 'eq' as const }],
        update: { email: 'Bulk.Update@Example.COM' }
      })
      expect(await accountEmail('a1')).toBe('bulk.update@example.com')
    })
  })
})

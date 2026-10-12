import type { TestDatabase } from '@/lib/database/testing/createTestDatabase'
import { withTimeZone } from '@/lib/testing/withTimeZone'
import { logger } from '@/lib/utils/logger'

import type { AuthKysely } from './kyselyAdapter'
import {
  type SessionDateRow,
  type SessionInvalidDateRow,
  type TestAdapter,
  type UserRow,
  createCountersTable,
  createTestDatabase,
  resetTables,
  timestampType
} from './kyselyAdapter.testUtils'

vi.mock('better-auth/adapters', () => import('./kyselyAdapter.testFactory'))

const isPostgres = process.env.TEST_DATABASE_TYPE === 'pg'

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

  const getLoginTotal = async () => {
    const row = await db
      .selectFrom('counters')
      .select((eb) => eb.fn.sum<number | string | null>('value').as('total'))
      .where('id', 'like', 'bucket:logins:%')
      .executeTakeFirst()
    return Number(row?.total ?? 0)
  }

  const findRow = (table: string, id: string) =>
    db.selectFrom(table).selectAll().where('id', '=', id).executeTakeFirst()

  describe('create', () => {
    it('inserts a record and returns it', async () => {
      const result = await adapter.create({
        model: 'users',
        data: {
          id: 'u1',
          display_name: 'Alice',
          email: 'alice@test.com',
          email_verified: false
        }
      })

      expect(result).toMatchObject({
        id: 'u1',
        display_name: 'Alice',
        email: 'alice@test.com'
      })
    })

    it('creates multiple records', async () => {
      await adapter.create({
        model: 'users',
        data: { id: 'u-a', email: 'one@test.com' }
      })
      await adapter.create({
        model: 'users',
        data: { id: 'u-b', email: 'two@test.com' }
      })

      const count = await adapter.count({ model: 'users' })
      expect(count).toBe(2)
    })

    it('records weekly login counters when creating sessions', async () => {
      await db
        .insertInto('users')
        .values({ id: 'u-login', email: 'login@test.com' })
        .execute()

      try {
        // Only Date: a faked setTimeout/setImmediate would stall the pool.
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-02-04T10:00:00.000Z'))

        await adapter.create({
          model: 'sessions',
          data: {
            id: 's-login-1',
            user_id: 'u-login',
            token: 'login-token-1',
            expireAt: new Date(Date.now() + 60_000)
          }
        })
        await adapter.create({
          model: 'sessions',
          data: {
            id: 's-login-2',
            user_id: 'u-login',
            token: 'login-token-2',
            expireAt: new Date(Date.now() + 120_000)
          }
        })

        const markerRows = await db
          .selectFrom('counters')
          .select(['id', 'value'])
          .where('id', '=', 'unique-login:u-login')
          .execute()

        expect(await getLoginTotal()).toBe(1)
        expect(markerRows).toEqual([
          {
            id: 'unique-login:u-login',
            value: Math.floor(Date.UTC(2026, 1, 2) / 1000)
          }
        ])
      } finally {
        vi.useRealTimers()
      }
    })

    it('records weekly login counters when creating a singular session model', async () => {
      await db
        .insertInto('users')
        .values({ id: 'u-singular-login', email: 'singular-login@test.com' })
        .execute()

      try {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-02-04T10:00:00.000Z'))

        await adapter.create({
          model: 'session',
          data: {
            id: 's-singular-login',
            user_id: 'u-singular-login',
            token: 'singular-login-token',
            expireAt: new Date(Date.now() + 60_000)
          }
        })

        expect(await getLoginTotal()).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('uses the Better Auth user id before stray accountId session fields', async () => {
      await db
        .insertInto('users')
        .values([
          { id: 'u-ba-canonical', email: 'ba-canonical@test.com' },
          { id: 'u-ba-stray', email: 'ba-stray@test.com' }
        ])
        .execute()

      try {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-02-04T10:00:00.000Z'))

        await adapter.create({
          model: 'session',
          data: {
            id: 's-ba-precedence',
            user_id: 'u-ba-canonical',
            accountId: 'u-ba-stray',
            token: 'ba-precedence-token',
            expireAt: new Date(Date.now() + 60_000)
          }
        })

        const markerRows = await db
          .selectFrom('counters')
          .select(['id', 'value'])
          .where('id', 'like', 'unique-login:%')
          .execute()
        const sessionRow = await findRow('session', 's-ba-precedence')

        expect(markerRows).toEqual([
          {
            id: 'unique-login:u-ba-canonical',
            value: Math.floor(Date.UTC(2026, 1, 2) / 1000)
          }
        ])
        expect(sessionRow?.accountId).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not require accountId columns on singular session tables', async () => {
      const singular = await createTestDatabase({ isolated: true })
      const singularDb = singular.db

      try {
        await singularDb.schema.dropTable('session').execute()
        await singularDb.schema
          .createTable('session')
          .addColumn('id', 'text', (column) => column.primaryKey())
          .addColumn('user_id', 'text', (column) =>
            column.references('users.id')
          )
          .addColumn('token', 'text', (column) => column.unique())
          .addColumn('expireAt', timestampType(singular.testDb.backend))
          .addColumn('createdAt', timestampType(singular.testDb.backend))
          .execute()
        await singularDb
          .insertInto('users')
          .values({
            id: 'u-singular-no-account-column',
            email: 'singular-no-account-column@test.com'
          })
          .execute()

        await expect(
          singular.adapter.create({
            model: 'session',
            data: {
              id: 's-singular-no-account-column',
              user_id: 'u-singular-no-account-column',
              accountId: 'u-should-not-be-inserted',
              token: 'singular-no-account-column-token',
              expireAt: new Date(Date.now() + 60_000)
            }
          })
        ).resolves.toMatchObject({
          id: 's-singular-no-account-column',
          user_id: 'u-singular-no-account-column'
        })

        await expect(
          singularDb
            .selectFrom('counters')
            .selectAll()
            .where('id', '=', 'unique-login:u-singular-no-account-column')
            .executeTakeFirst()
        ).resolves.toMatchObject({
          id: 'unique-login:u-singular-no-account-column'
        })
      } finally {
        await singular.testDb.destroy()
      }
    })

    it('creates sessions when login counter recording fails', async () => {
      const errorSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => undefined)

      try {
        await db
          .insertInto('users')
          .values({ id: 'u-login-failure', email: 'login-failure@test.com' })
          .execute()
        await db.schema.dropTable('counters').execute()

        await expect(
          adapter.create({
            model: 'session',
            data: {
              id: 's-login-failure',
              user_id: 'u-login-failure',
              token: 'login-failure-token',
              expireAt: new Date(Date.now() + 60_000)
            }
          })
        ).resolves.toMatchObject({
          id: 's-login-failure',
          user_id: 'u-login-failure'
        })

        await expect(
          findRow('session', 's-login-failure')
        ).resolves.toMatchObject({
          id: 's-login-failure',
          user_id: 'u-login-failure'
        })
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({ accountId: 'u-login-failure' }),
          'Failed to record weekly login'
        )
      } finally {
        await new Promise((resolve) => setImmediate(resolve))
        errorSpy.mockRestore()
        await db.schema.dropTable('counters').ifExists().execute()
        await createCountersTable(db, testDb.backend)
      }
    })

    it('records session timestamp strings without timezone as UTC', async () => {
      await withTimeZone('Europe/Amsterdam', async () => {
        await db
          .insertInto('users')
          .values({ id: 'u-sqlite-time', email: 'sqlite-time@test.com' })
          .execute()

        await adapter.create({
          model: 'sessions',
          data: {
            id: 's-sqlite-time',
            user_id: 'u-sqlite-time',
            token: 'sqlite-time-token',
            createdAt: '2026-05-25 00:30:00.000',
            expireAt: '2026-06-25 00:30:00.000'
          }
        })

        const markerRows = await db
          .selectFrom('counters')
          .select(['id', 'value'])
          .where('id', '=', 'unique-login:u-sqlite-time')
          .execute()

        expect(markerRows).toEqual([
          {
            id: 'unique-login:u-sqlite-time',
            value: Math.floor(Date.UTC(2026, 4, 25) / 1000)
          }
        ])
      })
    })
  })

  describe('findOne', () => {
    beforeEach(async () => {
      await db
        .insertInto('users')
        .values([
          { id: 'u1', display_name: 'Alice', email: 'alice@test.com' },
          { id: 'u2', display_name: 'Bob', email: 'bob@test.com' }
        ])
        .execute()
    })

    it('returns the first matching row', async () => {
      const result = await adapter.findOne({
        model: 'users',
        where: [
          { field: 'email', value: 'alice@test.com', operator: 'eq' as const }
        ]
      })

      expect(result).toMatchObject({ id: 'u1', display_name: 'Alice' })
    })

    it('returns null when no match', async () => {
      const result = await adapter.findOne({
        model: 'users',
        where: [
          {
            field: 'email',
            value: 'nobody@test.com',
            operator: 'eq' as const
          }
        ]
      })

      expect(result).toBeNull()
    })

    it('supports select to project specific columns', async () => {
      const result = await adapter.findOne({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }],
        select: ['email']
      })

      expect(result).toHaveProperty('email', 'alice@test.com')
      expect(result).not.toHaveProperty('display_name')
    })

    it('hydrates date fields from stored timestamps', async () => {
      const createdAt = new Date('2026-05-16T10:00:00.000Z').getTime()
      const expireAt = new Date('2026-05-17T10:00:00.000Z').getTime()
      await db
        .insertInto('sessions')
        .values({
          id: 's1',
          user_id: 'u1',
          token: 'token-1',
          createdAt: new Date(createdAt),
          expireAt: new Date(expireAt)
        })
        .execute()

      const result = await adapter.findOne<SessionDateRow>({
        model: 'sessions',
        where: [{ field: 'id', value: 's1', operator: 'eq' as const }]
      })

      if (!result) throw new Error('Expected a session row')

      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(createdAt)
      expect(result.expireAt).toBeInstanceOf(Date)
      expect(result.expireAt.getTime()).toBe(expireAt)
    })

    // SQLite only: PostgreSQL refuses the text in a timestamptz column. The
    // driver reads text it cannot parse as a time as NaN, and hydration leaves
    // a value it cannot turn into a valid Date as it is.
    it.skipIf(isPostgres)(
      'leaves invalid date fields as read while hydrating valid fields',
      async () => {
        const expireAt = new Date('2026-05-17T10:00:00.000Z').getTime()
        await db
          .insertInto('sessions')
          .values({
            id: 's-invalid-date',
            user_id: 'u1',
            token: 'token-invalid-date',
            createdAt: 'not-a-date',
            expireAt: new Date(expireAt)
          })
          .execute()

        const result = await adapter.findOne<SessionInvalidDateRow>({
          model: 'sessions',
          where: [
            { field: 'id', value: 's-invalid-date', operator: 'eq' as const }
          ]
        })

        if (!result) throw new Error('Expected a session row')

        expect(result.createdAt).toBeNaN()
        expect(result.expireAt).toBeInstanceOf(Date)
        expect(result.expireAt.getTime()).toBe(expireAt)
      }
    )

    // Which columns are dates comes from better-auth's schema, not from the
    // column name: `revoked` (like better-auth's oauthRefreshToken.revoked) is
    // a date with no `At` suffix, and `issuedAt` here is a string.
    it('hydrates by the schema field type rather than the At suffix', async () => {
      const revoked = new Date('2026-05-18T10:00:00.000Z')
      await adapter.create({
        model: 'tokens',
        data: { id: 't1', revoked, issuedAt: '2026-05-18 10:00:00' }
      })

      const result = await adapter.findOne<{
        revoked: Date
        issuedAt: string
      }>({
        model: 'tokens',
        where: [{ field: 'id', value: 't1', operator: 'eq' as const }]
      })

      expect(result?.revoked).toBeInstanceOf(Date)
      expect(result?.revoked.toISOString()).toBe(revoked.toISOString())
      expect(result?.issuedAt).toBe('2026-05-18 10:00:00')
    })
  })

  describe('findMany', () => {
    beforeEach(async () => {
      await db
        .insertInto('users')
        .values([
          { id: 'u1', display_name: 'Alice', email: 'alice@test.com' },
          { id: 'u2', display_name: 'Bob', email: 'bob@test.com' },
          { id: 'u3', display_name: 'Charlie', email: 'charlie@test.com' }
        ])
        .execute()
    })

    it('returns all rows when no where clause', async () => {
      const results = await adapter.findMany({ model: 'users' })
      expect(results).toHaveLength(3)
    })

    it('filters with where clause', async () => {
      const results = await adapter.findMany<UserRow>({
        model: 'users',
        where: [
          { field: 'display_name', value: 'Bob', operator: 'eq' as const }
        ]
      })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('u2')
    })

    it('respects limit', async () => {
      const results = await adapter.findMany({ model: 'users', limit: 2 })
      expect(results).toHaveLength(2)
    })

    it('respects offset', async () => {
      const results = await adapter.findMany<UserRow>({
        model: 'users',
        limit: 2,
        offset: 1,
        sortBy: { field: 'email', direction: 'asc' }
      })
      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('u2')
    })

    // SQLite only accepts OFFSET after a LIMIT.
    it('respects offset without a limit', async () => {
      const results = await adapter.findMany<UserRow>({
        model: 'users',
        offset: 1,
        sortBy: { field: 'email', direction: 'asc' }
      })
      expect(results.map((row) => row.id)).toEqual(['u2', 'u3'])
    })

    it('sorts by field', async () => {
      const results = await adapter.findMany<UserRow>({
        model: 'users',
        sortBy: { field: 'email', direction: 'desc' }
      })
      expect(results[0].email).toBe('charlie@test.com')
      expect(results[2].email).toBe('alice@test.com')
    })

    it('supports select projection', async () => {
      const results = await adapter.findMany({
        model: 'users',
        select: ['email']
      })
      expect(results).toHaveLength(3)
      expect(results[0]).toHaveProperty('email')
      expect(results[0]).not.toHaveProperty('display_name')
    })
  })

  describe('update', () => {
    beforeEach(async () => {
      await db
        .insertInto('users')
        .values({ id: 'u1', display_name: 'Alice', email: 'alice@test.com' })
        .execute()
    })

    it('updates the record and returns updated row', async () => {
      const result = await adapter.update<UserRow>({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }],
        update: { display_name: 'Alice Updated' }
      })

      if (!result) throw new Error('Expected an updated user row')

      expect(result.display_name).toBe('Alice Updated')
    })

    it('returns null when no matching record', async () => {
      const result = await adapter.update({
        model: 'users',
        where: [{ field: 'id', value: 'nonexistent', operator: 'eq' as const }],
        update: { display_name: 'Ghost' }
      })

      expect(result).toBeNull()
    })

    it('only updates the first matching row when where is non-unique', async () => {
      await db
        .insertInto('users')
        .values([
          { id: 'u2', display_name: 'Bob', email: 'bob@test.com' },
          { id: 'u3', display_name: 'Bob', email: 'bob2@test.com' }
        ])
        .execute()

      await adapter.update({
        model: 'users',
        where: [
          { field: 'display_name', value: 'Bob', operator: 'eq' as const }
        ],
        update: { display_name: 'Bob Updated' }
      })

      const all = await db
        .selectFrom('users')
        .selectAll()
        .where('id', 'in', ['u2', 'u3'])
        .orderBy('id')
        .execute()
      const updatedCount = all.filter(
        (r: any) => r.display_name === 'Bob Updated'
      ).length
      expect(updatedCount).toBe(1)
    })
  })

  describe('updateMany', () => {
    beforeEach(async () => {
      await db
        .insertInto('users')
        .values([
          {
            id: 'u1',
            display_name: 'Alice',
            email: 'a@test.com',
            email_verified: false
          },
          {
            id: 'u2',
            display_name: 'Bob',
            email: 'b@test.com',
            email_verified: false
          }
        ])
        .execute()
    })

    it('updates multiple rows and returns count', async () => {
      // The factory hands booleans over as 0/1 on SQLite (the adapter sets
      // `supportsBooleans: false` there) and as booleans on PostgreSQL.
      const [unverified, verified] = isPostgres ? [false, true] : [0, 1]
      const count = await adapter.updateMany({
        model: 'users',
        where: [
          {
            field: 'email_verified',
            value: unverified,
            operator: 'eq' as const
          }
        ],
        update: { email_verified: verified }
      })

      expect(count).toBe(2)
    })
  })

  describe('delete', () => {
    beforeEach(async () => {
      await db
        .insertInto('users')
        .values({ id: 'u1', display_name: 'Alice', email: 'alice@test.com' })
        .execute()
    })

    it('deletes matching record', async () => {
      await adapter.delete({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }]
      })

      const row = await findRow('users', 'u1')
      expect(row).toBeUndefined()
    })
  })

  describe('deleteMany', () => {
    beforeEach(async () => {
      await db
        .insertInto('users')
        .values([
          { id: 'u1', email: 'a@test.com' },
          { id: 'u2', email: 'b@test.com' },
          { id: 'u3', email: 'c@test.com' }
        ])
        .execute()
    })

    it('deletes multiple rows and returns count', async () => {
      const count = await adapter.deleteMany({
        model: 'users',
        where: [{ field: 'id', value: ['u1', 'u2'], operator: 'in' as const }]
      })

      expect(count).toBe(2)
      const remaining = await db.selectFrom('users').selectAll().execute()
      expect(remaining).toHaveLength(1)
    })
  })

  describe('count', () => {
    beforeEach(async () => {
      await db
        .insertInto('users')
        .values([
          { id: 'u1', email: 'a@test.com' },
          { id: 'u2', email: 'b@test.com' },
          { id: 'u3', email: 'c@test.com' }
        ])
        .execute()
    })

    it('returns total count without where', async () => {
      const count = await adapter.count({ model: 'users' })
      expect(count).toBe(3)
    })

    it('returns filtered count with where', async () => {
      const count = await adapter.count({
        model: 'users',
        where: [
          { field: 'email', value: 'a@test.com', operator: 'eq' as const }
        ]
      })
      expect(count).toBe(1)
    })
  })

  describe('where operators', () => {
    beforeEach(async () => {
      await db
        .insertInto('users')
        .values([
          { id: 'u1', display_name: 'Alice', email: 'alice@test.com' },
          { id: 'u2', display_name: 'Bob', email: 'bob@test.com' },
          { id: 'u3', display_name: 'Charlie', email: 'charlie@test.com' }
        ])
        .execute()
    })

    it('ne operator', async () => {
      const results = await adapter.findMany({
        model: 'users',
        where: [
          { field: 'display_name', value: 'Alice', operator: 'ne' as const }
        ]
      })
      expect(results).toHaveLength(2)
    })

    it('in operator', async () => {
      const results = await adapter.findMany({
        model: 'users',
        where: [
          {
            field: 'id',
            value: ['u1', 'u3'],
            operator: 'in' as const
          }
        ]
      })
      expect(results).toHaveLength(2)
    })

    it.each([
      {
        description: 'excludes rows whose value is in a not_in list',
        where: {
          field: 'id',
          value: ['u1', 'u3'],
          operator: 'not_in' as const
        },
        expectedIds: ['u2']
      },
      {
        description: 'matches substrings with the contains operator',
        where: {
          field: 'display_name',
          value: 'li',
          operator: 'contains' as const
        },
        expectedIds: ['u1', 'u3']
      },
      {
        description: 'matches prefixes with the starts_with operator',
        where: {
          field: 'display_name',
          value: 'Ch',
          operator: 'starts_with' as const
        },
        expectedIds: ['u3']
      },
      {
        description: 'matches suffixes with the ends_with operator',
        where: {
          field: 'email',
          value: '@test.com',
          operator: 'ends_with' as const
        },
        expectedIds: ['u1', 'u2', 'u3']
      },
      // `in ()` is a syntax error on PostgreSQL; an empty list matches no row
      // and an empty exclusion list every row, as they did under Knex.
      {
        description: 'matches nothing for an empty in list',
        where: { field: 'id', value: [], operator: 'in' as const },
        expectedIds: []
      },
      {
        description: 'matches everything for an empty not_in list',
        where: { field: 'id', value: [], operator: 'not_in' as const },
        expectedIds: ['u1', 'u2', 'u3']
      }
    ])('$description', async ({ where, expectedIds }) => {
      const results = await adapter.findMany({
        model: 'users',
        where: [where]
      })
      expect(results.map((r: any) => r.id).sort()).toEqual(expectedIds)
    })

    it('escapes LIKE wildcards in contains', async () => {
      await db
        .insertInto('users')
        .values({ id: 'u4', display_name: '100% done', email: 'd@test.com' })
        .execute()

      const results = await adapter.findMany<UserRow>({
        model: 'users',
        where: [
          {
            field: 'display_name',
            value: '100%',
            operator: 'contains' as const
          }
        ]
      })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('u4')
    })

    it.each([
      { description: 'an underscore', stored: 'a_b', other: 'axb', value: '_' },
      {
        description: 'a backslash',
        stored: 'a\\b',
        other: 'ab',
        value: '\\'
      }
    ])('escapes $description in contains', async ({ stored, other, value }) => {
      await db
        .insertInto('users')
        .values([
          { id: 'u-stored', display_name: stored, email: 's@test.com' },
          { id: 'u-other', display_name: other, email: 'o@test.com' }
        ])
        .execute()

      const results = await adapter.findMany<UserRow>({
        model: 'users',
        where: [{ field: 'display_name', value, operator: 'contains' as const }]
      })
      expect(results.map((row) => row.id)).toEqual(['u-stored'])
    })

    it('throws on unsupported operator', async () => {
      await expect(
        adapter.findMany({
          model: 'users',
          where: [
            {
              field: 'email',
              value: 'test',
              operator: 'invalid_op' as any
            }
          ]
        })
      ).rejects.toThrow('Unsupported where operator: invalid_op')
    })

    it('refuses an undefined comparison value', async () => {
      await expect(
        adapter.findOne({
          model: 'users',
          where: [{ field: 'id', value: undefined as any, operator: 'eq' }]
        })
      ).rejects.toThrow('Undefined value in the where clause on users.id')
    })

    it('OR connector', async () => {
      const results = await adapter.findMany({
        model: 'users',
        where: [
          {
            field: 'display_name',
            value: 'Alice',
            operator: 'eq' as const,
            connector: 'AND' as const
          },
          {
            field: 'display_name',
            value: 'Bob',
            operator: 'eq' as const,
            connector: 'OR' as const
          }
        ]
      })
      expect(results).toHaveLength(2)
    })

    // AND binds tighter than OR, as in the Knex where/orWhere chain this
    // replaced: `a AND b OR c` is `(a AND b) OR c`.
    it('groups AND clauses on either side of an OR', async () => {
      const results = await adapter.findMany({
        model: 'users',
        where: [
          { field: 'display_name', value: 'Alice', operator: 'eq' as const },
          {
            field: 'email',
            value: 'nobody@test.com',
            operator: 'eq' as const,
            connector: 'AND' as const
          },
          {
            field: 'display_name',
            value: 'Bob',
            operator: 'eq' as const,
            connector: 'OR' as const
          },
          {
            field: 'email',
            value: 'bob@test.com',
            operator: 'eq' as const,
            connector: 'AND' as const
          }
        ]
      })
      expect(results.map((r: any) => r.id)).toEqual(['u2'])
    })
  })

  describe('cross-table operations', () => {
    it('creates and finds records across related tables', async () => {
      await adapter.create({
        model: 'users',
        data: { id: 'u1', display_name: 'Alice', email: 'alice@test.com' }
      })

      await adapter.create({
        model: 'accounts',
        data: {
          id: 'a1',
          user_id: 'u1',
          provider: 'credential',
          provider_account_id: 'u1',
          password: 'hashed_pw'
        }
      })

      const account = await adapter.findOne({
        model: 'accounts',
        where: [
          { field: 'user_id', value: 'u1', operator: 'eq' as const },
          { field: 'provider', value: 'credential', operator: 'eq' as const }
        ]
      })

      expect(account).toMatchObject({
        id: 'a1',
        user_id: 'u1',
        provider: 'credential',
        password: 'hashed_pw'
      })
    })
  })
})

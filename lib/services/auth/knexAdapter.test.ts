import knex, { Knex } from 'knex'

import { logger } from '@/lib/utils/logger'

import { knexAdapter } from './knexAdapter'

vi.mock('better-auth/adapters', () => {
  // Mirrors the schema better-auth hands the adapter: keyed by model name, with
  // the table under `modelName` and each field's column under `fieldName` (here
  // the field name is the column, matching the identity helpers below). The
  // adapter reads it to learn which columns a joined table contributes.
  //
  // `accounts` is deliberately absent so the join tests can also exercise the
  // path for a table the schema does not describe.
  const schema = {
    users: {
      modelName: 'users',
      fields: {
        display_name: {},
        email: {},
        email_verified: {},
        createdAt: {},
        created_at: {},
        updated_at: {}
      }
    },
    sessions: {
      modelName: 'sessions',
      fields: {
        user_id: {},
        accountId: {},
        token: {},
        expires_at: {},
        createdAt: {},
        expireAt: {}
      }
    }
  }

  return {
    createAdapterFactory: ({
      adapter
    }: {
      config: Record<string, unknown>
      adapter: (helpers: {
        getModelName: (model: string) => string
        getFieldName: (opts: { model: string; field: string }) => string
        schema: unknown
      }) => Record<string, (...args: any[]) => any>
    }) => {
      // Return a factory that, when called, invokes the adapter with
      // identity getModelName/getFieldName (no field remapping).
      return () =>
        adapter({
          getModelName: (m) => m,
          getFieldName: (o) => o.field,
          schema
        })
    }
  }
})

describe('knexAdapter', () => {
  let db: Knex
  let adapter: ReturnType<ReturnType<typeof knexAdapter>>

  beforeAll(async () => {
    db = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await db.schema.createTable('users', (table) => {
      table.text('id').primary()
      table.text('display_name')
      table.text('email').unique()
      table.boolean('email_verified').defaultTo(false)
      table.timestamp('created_at')
      table.timestamp('updated_at')
      // Named like the real `accounts.createdAt` so the `At`-suffix hydration
      // rule applies to it when this table is the joined side of a join.
      table.timestamp('createdAt')
    })

    await db.schema.createTable('accounts', (table) => {
      table.text('id').primary()
      table.text('user_id').references('id').inTable('users')
      table.text('provider')
      table.text('provider_account_id')
      table.text('password')
    })

    await db.schema.createTable('sessions', (table) => {
      table.text('id').primary()
      table.text('user_id').references('id').inTable('users')
      table.text('accountId')
      table.text('token').unique()
      table.timestamp('expires_at')
      table.timestamp('createdAt')
      table.timestamp('expireAt')
    })

    await db.schema.createTable('session', (table) => {
      table.text('id').primary()
      table.text('user_id').references('id').inTable('users')
      table.text('accountId')
      table.text('token').unique()
      table.timestamp('expires_at')
      table.timestamp('createdAt')
      table.timestamp('expireAt')
    })

    await db.schema.createTable('counters', (table) => {
      table.string('id').primary()
      table.integer('value').defaultTo(0)
      table.timestamp('bucketHour', { useTz: true }).nullable()
      table.timestamp('createdAt', { useTz: true })
      table.timestamp('updatedAt', { useTz: true })
    })

    await db.schema.createTable('passkey', (table) => {
      table.string('id').primary()
      table.string('userId')
      table.string('rpID').nullable()
    })

    // The mock createAdapterFactory above uses identity getModelName/getFieldName.
    // This means table names = model names and field names are used as-is,
    // which lets us test the raw adapter CRUD logic and where-clause operators.
    const factory = knexAdapter(db)
    adapter = factory({} as any)
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await db('counters').delete()
    await db('session').delete()
    await db('sessions').delete()
    await db('accounts').delete()
    await db('users').delete()
    await db('passkey').delete()
  })

  describe('passkey rpID stamping', () => {
    it('stamps the instance rpID onto a new passkey row', async () => {
      const adapterWithRpID = knexAdapter(db, {
        passkeyRpID: 'social.example'
      })({} as any)

      await adapterWithRpID.create({
        model: 'passkey',
        data: { id: 'pk1', userId: 'u1' }
      })

      const row = await db('passkey').where('id', 'pk1').first()
      expect(row.rpID).toBe('social.example')
    })

    it('does not overwrite an rpID already present in the data', async () => {
      const adapterWithRpID = knexAdapter(db, {
        passkeyRpID: 'social.example'
      })({} as any)

      await adapterWithRpID.create({
        model: 'passkey',
        data: { id: 'pk2', userId: 'u1', rpID: 'photos.example' }
      })

      const row = await db('passkey').where('id', 'pk2').first()
      expect(row.rpID).toBe('photos.example')
    })

    it('leaves rpID null when the adapter has no configured rpID', async () => {
      await adapter.create({
        model: 'passkey',
        data: { id: 'pk3', userId: 'u1' }
      })

      const row = await db('passkey').where('id', 'pk3').first()
      expect(row.rpID).toBeNull()
    })
  })

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
      const getLoginTotal = async () => {
        const row = await db('counters')
          .where('id', 'like', 'bucket:logins:%')
          .sum<{ total: number | string | null }>('value as total')
          .first()
        return Number(row?.total ?? 0)
      }

      await db('users').insert({
        id: 'u-login',
        email: 'login@test.com'
      })

      try {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-02-04T10:00:00.000Z'))

        await adapter.create({
          model: 'sessions',
          data: {
            id: 's-login-1',
            user_id: 'u-login',
            token: 'login-token-1',
            expireAt: Date.now() + 60_000
          }
        })
        await adapter.create({
          model: 'sessions',
          data: {
            id: 's-login-2',
            user_id: 'u-login',
            token: 'login-token-2',
            expireAt: Date.now() + 120_000
          }
        })

        const markerRows = await db('counters')
          .where('id', 'unique-login:u-login')
          .select('id', 'value')

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
      const getLoginTotal = async () => {
        const row = await db('counters')
          .where('id', 'like', 'bucket:logins:%')
          .sum<{ total: number | string | null }>('value as total')
          .first()
        return Number(row?.total ?? 0)
      }

      await db('users').insert({
        id: 'u-singular-login',
        email: 'singular-login@test.com'
      })

      try {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-02-04T10:00:00.000Z'))

        await adapter.create({
          model: 'session',
          data: {
            id: 's-singular-login',
            user_id: 'u-singular-login',
            token: 'singular-login-token',
            expireAt: Date.now() + 60_000
          }
        })

        expect(await getLoginTotal()).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('uses the Better Auth user id before stray accountId session fields', async () => {
      await db('users').insert([
        {
          id: 'u-ba-canonical',
          email: 'ba-canonical@test.com'
        },
        {
          id: 'u-ba-stray',
          email: 'ba-stray@test.com'
        }
      ])

      try {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-02-04T10:00:00.000Z'))

        await adapter.create({
          model: 'session',
          data: {
            id: 's-ba-precedence',
            user_id: 'u-ba-canonical',
            accountId: 'u-ba-stray',
            token: 'ba-precedence-token',
            expireAt: Date.now() + 60_000
          }
        })

        const markerRows = await db('counters')
          .where('id', 'like', 'unique-login:%')
          .select('id', 'value')
        const sessionRow = await db('session')
          .where('id', 's-ba-precedence')
          .first()

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
      const singularDb = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: ':memory:' }
      })
      const singularAdapter = knexAdapter(singularDb)({} as never)

      try {
        await singularDb.schema.createTable('users', (table) => {
          table.text('id').primary()
          table.text('email')
        })
        await singularDb.schema.createTable('session', (table) => {
          table.text('id').primary()
          table.text('user_id').references('id').inTable('users')
          table.text('token').unique()
          table.timestamp('expireAt')
          table.timestamp('createdAt')
        })
        await singularDb.schema.createTable('counters', (table) => {
          table.string('id').primary()
          table.integer('value').defaultTo(0)
          table.timestamp('bucketHour', { useTz: true }).nullable()
          table.timestamp('createdAt', { useTz: true })
          table.timestamp('updatedAt', { useTz: true })
        })
        await singularDb('users').insert({
          id: 'u-singular-no-account-column',
          email: 'singular-no-account-column@test.com'
        })

        await expect(
          singularAdapter.create({
            model: 'session',
            data: {
              id: 's-singular-no-account-column',
              user_id: 'u-singular-no-account-column',
              accountId: 'u-should-not-be-inserted',
              token: 'singular-no-account-column-token',
              expireAt: Date.now() + 60_000
            }
          })
        ).resolves.toMatchObject({
          id: 's-singular-no-account-column',
          user_id: 'u-singular-no-account-column'
        })

        await expect(
          singularDb('counters')
            .where('id', 'unique-login:u-singular-no-account-column')
            .first()
        ).resolves.toMatchObject({
          id: 'unique-login:u-singular-no-account-column'
        })
      } finally {
        await singularDb.destroy()
      }
    })

    it('creates sessions when login counter recording fails', async () => {
      const errorSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => undefined)

      try {
        await db('users').insert({
          id: 'u-login-failure',
          email: 'login-failure@test.com'
        })
        await db.schema.dropTable('counters')

        await expect(
          adapter.create({
            model: 'session',
            data: {
              id: 's-login-failure',
              user_id: 'u-login-failure',
              token: 'login-failure-token',
              expireAt: Date.now() + 60_000
            }
          })
        ).resolves.toMatchObject({
          id: 's-login-failure',
          user_id: 'u-login-failure'
        })

        await expect(
          db('session').where('id', 's-login-failure').first()
        ).resolves.toMatchObject({
          id: 's-login-failure',
          user_id: 'u-login-failure'
        })
      } finally {
        await new Promise((resolve) => setImmediate(resolve))
        errorSpy.mockRestore()
        const hasCounters = await db.schema.hasTable('counters')
        if (!hasCounters) {
          await db.schema.createTable('counters', (table) => {
            table.string('id').primary()
            table.integer('value').defaultTo(0)
            table.timestamp('bucketHour', { useTz: true }).nullable()
            table.timestamp('createdAt', { useTz: true })
            table.timestamp('updatedAt', { useTz: true })
          })
        }
      }
    })

    it('records session timestamp strings without timezone as UTC', async () => {
      const originalTimeZone = process.env.TZ
      process.env.TZ = 'Europe/Amsterdam'

      try {
        await db('users').insert({
          id: 'u-sqlite-time',
          email: 'sqlite-time@test.com'
        })

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

        const markerRows = await db('counters')
          .where('id', 'unique-login:u-sqlite-time')
          .select('id', 'value')

        expect(markerRows).toEqual([
          {
            id: 'unique-login:u-sqlite-time',
            value: Math.floor(Date.UTC(2026, 4, 25) / 1000)
          }
        ])
      } finally {
        if (originalTimeZone === undefined) {
          delete process.env.TZ
        } else {
          process.env.TZ = originalTimeZone
        }
      }
    })
  })

  describe('findOne', () => {
    beforeEach(async () => {
      await db('users').insert([
        { id: 'u1', display_name: 'Alice', email: 'alice@test.com' },
        { id: 'u2', display_name: 'Bob', email: 'bob@test.com' }
      ])
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

    it('hydrates date-like fields from SQLite timestamps', async () => {
      const createdAt = new Date('2026-05-16T10:00:00.000Z').getTime()
      const expireAt = new Date('2026-05-17T10:00:00.000Z').getTime()
      await db('sessions').insert({
        id: 's1',
        user_id: 'u1',
        token: 'token-1',
        createdAt,
        expireAt
      })

      const result = await adapter.findOne({
        model: 'sessions',
        where: [{ field: 'id', value: 's1', operator: 'eq' as const }]
      })

      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(createdAt)
      expect(result.expireAt).toBeInstanceOf(Date)
      expect(result.expireAt.getTime()).toBe(expireAt)
    })

    it('leaves invalid date-like fields unchanged while hydrating valid fields', async () => {
      const expireAt = new Date('2026-05-17T10:00:00.000Z').getTime()
      await db('sessions').insert({
        id: 's-invalid-date',
        user_id: 'u1',
        token: 'token-invalid-date',
        createdAt: 'not-a-date',
        expireAt
      })

      const result = await adapter.findOne({
        model: 'sessions',
        where: [
          { field: 'id', value: 's-invalid-date', operator: 'eq' as const }
        ]
      })

      expect(result.createdAt).toBe('not-a-date')
      expect(result.expireAt).toBeInstanceOf(Date)
      expect(result.expireAt.getTime()).toBe(expireAt)
    })
  })

  describe('findMany', () => {
    beforeEach(async () => {
      await db('users').insert([
        { id: 'u1', display_name: 'Alice', email: 'alice@test.com' },
        { id: 'u2', display_name: 'Bob', email: 'bob@test.com' },
        { id: 'u3', display_name: 'Charlie', email: 'charlie@test.com' }
      ])
    })

    it('returns all rows when no where clause', async () => {
      const results = await adapter.findMany({ model: 'users' })
      expect(results).toHaveLength(3)
    })

    it('filters with where clause', async () => {
      const results = await adapter.findMany({
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
      const results = await adapter.findMany({
        model: 'users',
        limit: 2,
        offset: 1,
        sortBy: { field: 'email', direction: 'asc' }
      })
      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('u2')
    })

    it('sorts by field', async () => {
      const results = await adapter.findMany({
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

  describe('joins', () => {
    const USER_CREATED_AT = new Date('2026-05-16T10:00:00.000Z').getTime()
    const SESSION_CREATED_AT = new Date('2026-05-17T10:00:00.000Z').getTime()

    // Shaped like the config better-auth builds for `join: { user: true }` on a
    // session lookup: keyed by the joined TABLE name, with the joining columns
    // already resolved.
    const userJoin = {
      users: {
        on: { from: 'user_id', to: 'id' },
        limit: 1,
        relation: 'one-to-one' as const
      }
    }

    beforeEach(async () => {
      await db('users').insert([
        {
          id: 'u1',
          display_name: 'Alice',
          email: 'alice@test.com',
          createdAt: USER_CREATED_AT
        },
        { id: 'u2', display_name: 'Bob', email: 'bob@test.com' }
      ])
      await db('sessions').insert([
        {
          id: 's1',
          user_id: 'u1',
          accountId: 'a1',
          token: 't1',
          createdAt: SESSION_CREATED_AT
        },
        { id: 's2', user_id: 'u1', token: 't2' },
        { id: 's3', user_id: 'u2', token: 't3' },
        { id: 's-orphan', user_id: null, token: 't-orphan' }
      ])
    })

    it('nests a one-to-one related row under the joined table name', async () => {
      const result: any = await adapter.findOne({
        model: 'sessions',
        where: [{ field: 'id', value: 's1', operator: 'eq' as const }],
        join: userJoin
      })

      expect(result.users).toMatchObject({
        id: 'u1',
        display_name: 'Alice',
        email: 'alice@test.com'
      })
    })

    it('keeps the base row columns when the joined table repeats their names', async () => {
      const result: any = await adapter.findOne({
        model: 'sessions',
        where: [{ field: 'id', value: 's1', operator: 'eq' as const }],
        join: userJoin
      })

      // Both tables have `id` and `createdAt`; an unaliased join would have
      // overwritten the session's own values with the user's.
      expect(result.id).toBe('s1')
      expect(result.token).toBe('t1')
      expect(result.createdAt.getTime()).toBe(SESSION_CREATED_AT)
    })

    it('returns null for a one-to-one join with no matching row', async () => {
      const result: any = await adapter.findOne({
        model: 'sessions',
        where: [{ field: 'id', value: 's-orphan', operator: 'eq' as const }],
        join: userJoin
      })

      expect(result.id).toBe('s-orphan')
      expect(result.users).toBeNull()
    })

    it('hydrates date columns on the joined row', async () => {
      const result: any = await adapter.findOne({
        model: 'sessions',
        where: [{ field: 'id', value: 's1', operator: 'eq' as const }],
        join: userJoin
      })

      expect(result.users.createdAt).toBeInstanceOf(Date)
      expect(result.users.createdAt.getTime()).toBe(USER_CREATED_AT)
    })

    it('projects only the selected base columns while still joining', async () => {
      const result: any = await adapter.findOne({
        model: 'sessions',
        where: [{ field: 'id', value: 's1', operator: 'eq' as const }],
        select: ['id', 'user_id'],
        join: userJoin
      })

      expect(result).not.toHaveProperty('token')
      expect(result.id).toBe('s1')
      expect(result.users.id).toBe('u1')
    })

    it('joins every row returned by findMany', async () => {
      const results: any[] = await adapter.findMany({
        model: 'sessions',
        where: [{ field: 'user_id', value: 'u1', operator: 'eq' as const }],
        sortBy: { field: 'id', direction: 'asc' as const },
        join: userJoin
      })

      expect(results).toHaveLength(2)
      expect(results.map((row) => row.id)).toEqual(['s1', 's2'])
      expect(results.every((row) => row.users.id === 'u1')).toBe(true)
    })

    it('counts base rows for limit and offset when joining', async () => {
      const results: any[] = await adapter.findMany({
        model: 'sessions',
        sortBy: { field: 'id', direction: 'asc' as const },
        limit: 2,
        offset: 1,
        join: userJoin
      })

      // Ascending by id the rows are s-orphan, s1, s2, s3 ('-' sorts before a
      // digit), so offset 1 starts at s1. A one-to-one join must not change
      // that: the window still counts base rows, not joined rows.
      expect(results.map((row) => row.id)).toEqual(['s1', 's2'])
    })

    it('returns an array for a one-to-many join', async () => {
      const result: any = await adapter.findOne({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }],
        join: {
          sessions: {
            on: { from: 'id', to: 'user_id' },
            limit: 100,
            relation: 'one-to-many' as const
          }
        }
      })

      expect(result.sessions.map((row: any) => row.id).sort()).toEqual([
        's1',
        's2'
      ])
    })

    it('bounds a one-to-many join by its per-parent limit', async () => {
      const results: any[] = await adapter.findMany({
        model: 'users',
        sortBy: { field: 'id', direction: 'asc' as const },
        join: {
          sessions: {
            on: { from: 'id', to: 'user_id' },
            limit: 1,
            relation: 'one-to-many' as const
          }
        }
      })

      // u1 owns two sessions but the limit applies per parent row, which is why
      // this cannot be one joined statement.
      expect(results.map((row) => row.sessions.length)).toEqual([1, 1])
    })

    it('returns an empty array for a one-to-many join with no related rows', async () => {
      await db('sessions').delete()

      const result: any = await adapter.findOne({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }],
        join: {
          sessions: {
            on: { from: 'id', to: 'user_id' },
            limit: 100,
            relation: 'one-to-many' as const
          }
        }
      })

      expect(result.sessions).toEqual([])
    })

    it('falls back to a separate query for a table the schema does not describe', async () => {
      await db('accounts').insert({
        id: 'a1',
        user_id: 'u1',
        provider: 'credential'
      })

      const result: any = await adapter.findOne({
        model: 'sessions',
        where: [{ field: 'id', value: 's1', operator: 'eq' as const }],
        join: {
          accounts: {
            on: { from: 'accountId', to: 'id' },
            limit: 1,
            relation: 'one-to-one' as const
          }
        }
      })

      expect(result.id).toBe('s1')
      expect(result.accounts).toMatchObject({ id: 'a1', user_id: 'u1' })
    })

    it('leaves rows untouched when no join is requested', async () => {
      const result: any = await adapter.findOne({
        model: 'sessions',
        where: [{ field: 'id', value: 's1', operator: 'eq' as const }]
      })

      expect(result).not.toHaveProperty('users')
      expect(result.id).toBe('s1')
    })
  })

  describe('update', () => {
    beforeEach(async () => {
      await db('users').insert({
        id: 'u1',
        display_name: 'Alice',
        email: 'alice@test.com'
      })
    })

    it('updates the record and returns updated row', async () => {
      const result = await adapter.update({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }],
        update: { display_name: 'Alice Updated' }
      })

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
      await db('users').insert([
        { id: 'u2', display_name: 'Bob', email: 'bob@test.com' },
        { id: 'u3', display_name: 'Bob', email: 'bob2@test.com' }
      ])

      await adapter.update({
        model: 'users',
        where: [
          { field: 'display_name', value: 'Bob', operator: 'eq' as const }
        ],
        update: { display_name: 'Bob Updated' }
      })

      const all = await db('users').whereIn('id', ['u2', 'u3']).orderBy('id')
      const updatedCount = all.filter(
        (r: any) => r.display_name === 'Bob Updated'
      ).length
      expect(updatedCount).toBe(1)
    })
  })

  describe('updateMany', () => {
    beforeEach(async () => {
      await db('users').insert([
        {
          id: 'u1',
          display_name: 'Alice',
          email: 'a@test.com',
          email_verified: 0
        },
        {
          id: 'u2',
          display_name: 'Bob',
          email: 'b@test.com',
          email_verified: 0
        }
      ])
    })

    it('updates multiple rows and returns count', async () => {
      const count = await adapter.updateMany({
        model: 'users',
        where: [{ field: 'email_verified', value: 0, operator: 'eq' as const }],
        update: { email_verified: 1 }
      })

      expect(count).toBe(2)
    })
  })

  describe('delete', () => {
    beforeEach(async () => {
      await db('users').insert({
        id: 'u1',
        display_name: 'Alice',
        email: 'alice@test.com'
      })
    })

    it('deletes matching record', async () => {
      await adapter.delete({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }]
      })

      const row = await db('users').where('id', 'u1').first()
      expect(row).toBeUndefined()
    })
  })

  describe('deleteMany', () => {
    beforeEach(async () => {
      await db('users').insert([
        { id: 'u1', email: 'a@test.com' },
        { id: 'u2', email: 'b@test.com' },
        { id: 'u3', email: 'c@test.com' }
      ])
    })

    it('deletes multiple rows and returns count', async () => {
      const count = await adapter.deleteMany({
        model: 'users',
        where: [{ field: 'id', value: ['u1', 'u2'], operator: 'in' as const }]
      })

      expect(count).toBe(2)
      const remaining = await db('users').select()
      expect(remaining).toHaveLength(1)
    })
  })

  // better-auth 1.7 requires the adapter to implement these two atomic
  // primitives itself — the factory throws rather than synthesising a fallback,
  // because neither can be made race-safe from separate statements.
  describe('consumeOne', () => {
    beforeEach(async () => {
      await db('users').insert([
        { id: 'u1', display_name: 'Alice', email: 'alice@test.com' },
        { id: 'u2', display_name: 'Bob', email: 'bob@test.com' }
      ])
    })

    it('deletes the matching row and returns it', async () => {
      const row = await adapter.consumeOne<{ id: string; email: string }>({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }]
      })

      expect(row?.id).toBe('u1')
      expect(row?.email).toBe('alice@test.com')
      expect(await db('users').where('id', 'u1').first()).toBeUndefined()
      expect(await db('users').where('id', 'u2').first()).toBeDefined()
    })

    it('returns null when nothing matches', async () => {
      const row = await adapter.consumeOne({
        model: 'users',
        where: [{ field: 'id', value: 'missing', operator: 'eq' as const }]
      })

      expect(row).toBeNull()
      expect(await db('users').select()).toHaveLength(2)
    })

    it('deletes at most one row for a predicate matching several', async () => {
      const row = await adapter.consumeOne<{ id: string }>({
        model: 'users',
        where: [{ field: 'id', value: ['u1', 'u2'], operator: 'in' as const }]
      })

      expect(['u1', 'u2']).toContain(row?.id)
      expect(await db('users').select()).toHaveLength(1)
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
      expect(await db('users').where('id', 'u1').first()).toBeUndefined()
    })

    // The behavioural tests above pass whether or not the DELETE re-applies the
    // caller's predicate, because nothing in a single-threaded test changes the
    // row between the read and the delete. The race safety comes entirely from
    // that re-application — a racing caller re-evaluates it after the winner
    // commits — so the statement's shape is what has to be pinned.
    it('re-applies the caller predicate in the DELETE, not just the row id', async () => {
      const statements: string[] = []
      const record = ({ sql }: { sql: string }) => statements.push(sql)
      db.on('query', record)
      try {
        await adapter.consumeOne({
          model: 'users',
          where: [
            { field: 'id', value: 'u1', operator: 'eq' as const },
            { field: 'email', value: 'alice@test.com', operator: 'eq' as const }
          ]
        })
      } finally {
        db.off('query', record)
      }

      const deletes = statements.filter((sql) => sql.startsWith('delete'))
      expect(deletes).toHaveLength(1)
      expect(deletes[0]).toContain('email')
    })

    it('returns null rather than consuming an arbitrary row for an empty predicate', async () => {
      const row = await adapter.consumeOne({ model: 'users', where: [] })

      expect(row).toBeNull()
      expect(await db('users').select()).toHaveLength(2)
    })

    it('hydrates date columns on the returned row', async () => {
      const createdAt = new Date('2026-02-03T04:05:06.000Z')
      await db('users').insert({ id: 'u3', createdAt })

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
      await db('counters').insert([
        { id: 'c1', value: 5 },
        { id: 'c2', value: 0 }
      ])
    })

    it('applies the delta and returns the updated row', async () => {
      const row = await adapter.incrementOne<{ id: string; value: number }>({
        model: 'counters',
        where: [{ field: 'id', value: 'c1', operator: 'eq' as const }],
        increment: { value: 3 }
      })

      expect(row?.value).toBe(8)
      expect((await db('counters').where('id', 'c1').first())?.value).toBe(8)
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
      expect((await db('counters').where('id', 'c2').first())?.value).toBe(0)
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
      await db('counters').insert({ id: 'c3', value: 1, bucketHour: null })

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
      await db('counters').insert({ id: 'c4', value: 1, bucketHour: null })

      const unset = await adapter.incrementOne({
        model: 'counters',
        where: [
          { field: 'id', value: 'c4', operator: 'eq' as const },
          { field: 'bucketHour', value: null, operator: 'ne' as const }
        ],
        increment: { value: 1 }
      })
      expect(unset).toBeNull()

      await db('counters')
        .where('id', 'c4')
        .update({ bucketHour: new Date('2026-02-03T04:00:00.000Z') })
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

      const values = (await db('counters').orderBy('id').select('value')).map(
        (row: { value: number }) => row.value
      )
      expect(values.filter((value) => value >= 10)).toHaveLength(1)
    })

    // Same reasoning as consumeOne's: the guard only does anything under a
    // concurrent write, so pin that it reaches the UPDATE rather than being
    // spent on the id lookup alone.
    it('re-applies the caller predicate in the UPDATE, not just the row id', async () => {
      const statements: string[] = []
      const record = ({ sql }: { sql: string }) => statements.push(sql)
      db.on('query', record)
      try {
        await adapter.incrementOne({
          model: 'counters',
          where: [
            { field: 'id', value: 'c1', operator: 'eq' as const },
            { field: 'value', value: 0, operator: 'gt' as const }
          ],
          increment: { value: 1 }
        })
      } finally {
        db.off('query', record)
      }

      const updates = statements.filter((sql) => sql.startsWith('update'))
      expect(updates).toHaveLength(1)
      expect(updates[0]).toContain('value` >')
    })

    it('returns null rather than mutating an arbitrary row for an empty predicate', async () => {
      const row = await adapter.incrementOne({
        model: 'counters',
        where: [],
        increment: { value: 1 }
      })

      expect(row).toBeNull()
      expect((await db('counters').where('id', 'c1').first())?.value).toBe(5)
    })

    // An `OR`-connected predicate is emitted as `orWhere`, which would
    // re-associate against the primary-key clause that bounds the statement to
    // one row and let it mutate a row the caller never selected.
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
      const rows = await db('counters').orderBy('id').select('id', 'value')
      const changed = rows.filter(
        (entry: { id: string; value: number }) =>
          entry.value !== (entry.id === 'c1' ? 5 : 0)
      )
      expect(changed).toHaveLength(1)
    })
  })

  // Deleting a session that minted OAuth tokens trips the
  // oauthAccessToken/oauthRefreshToken sessionId FKs on PostgreSQL. The adapter
  // is what better-auth calls for sign-out and session cleanup, so it must
  // detach those tokens first. SQLite leaves FKs off by default, so this block
  // uses a dedicated database with enforcement ON to reproduce the constraint.
  describe('session deletion detaches OAuth tokens', () => {
    let fkDb: Knex
    let fkAdapter: ReturnType<ReturnType<typeof knexAdapter>>

    beforeAll(async () => {
      fkDb = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: ':memory:' },
        pool: {
          afterCreate: (
            conn: { pragma: (statement: string) => void },
            done: (error: Error | null, conn: unknown) => void
          ) => {
            conn.pragma('foreign_keys = ON')
            done(null, conn)
          }
        }
      })
      await fkDb.schema.createTable('sessions', (table) => {
        table.text('id').primary()
        table.text('token').unique()
      })
      await fkDb.schema.createTable('oauthAccessToken', (table) => {
        table.text('id').primary()
        table.text('sessionId').references('id').inTable('sessions')
      })
      await fkDb.schema.createTable('oauthRefreshToken', (table) => {
        table.text('id').primary()
        table.text('sessionId').references('id').inTable('sessions')
      })
      fkAdapter = knexAdapter(fkDb)({} as never)
    })

    afterAll(async () => {
      await fkDb.destroy()
    })

    beforeEach(async () => {
      await fkDb('oauthAccessToken').delete()
      await fkDb('oauthRefreshToken').delete()
      await fkDb('sessions').delete()
    })

    const seedSessionWithTokens = async (token: string) => {
      const sessionId = `sid-${token}`
      await fkDb('sessions').insert({ id: sessionId, token })
      await fkDb('oauthAccessToken').insert({ id: `at-${token}`, sessionId })
      await fkDb('oauthRefreshToken').insert({ id: `rt-${token}`, sessionId })
    }

    it('delete() detaches OAuth tokens before removing the session', async () => {
      const [{ foreign_keys: fkEnabled }] = await fkDb.raw(
        'PRAGMA foreign_keys'
      )
      // Guard against a vacuous test: without enforcement the naive delete
      // would pass too.
      expect(fkEnabled).toBe(1)

      await seedSessionWithTokens('signout-token')

      await expect(
        fkAdapter.delete({
          model: 'sessions',
          where: [
            { field: 'token', value: 'signout-token', operator: 'eq' as const }
          ]
        })
      ).resolves.toBeUndefined()

      expect(
        await fkDb('sessions').where('token', 'signout-token').first()
      ).toBeUndefined()
      expect(
        (await fkDb('oauthAccessToken').where('id', 'at-signout-token').first())
          ?.sessionId
      ).toBeNull()
      expect(
        (
          await fkDb('oauthRefreshToken')
            .where('id', 'rt-signout-token')
            .first()
        )?.sessionId
      ).toBeNull()
    })

    it('deleteMany() detaches a mixed batch and returns the deleted count', async () => {
      // bulk-a minted OAuth tokens; bulk-b did not. The realistic "revoke all
      // other sessions" case is a mix, and both must be deleted.
      await seedSessionWithTokens('bulk-a')
      await fkDb('sessions').insert({ id: 'sid-bulk-b', token: 'bulk-b' })

      const count = await fkAdapter.deleteMany({
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
      expect(await fkDb('sessions').select()).toHaveLength(0)
      // bulk-a's tokens must SURVIVE (not be deleted), detached from the
      // now-deleted session — asserting existence + null sessionId, not just
      // the absence of non-null links.
      const access = await fkDb('oauthAccessToken')
        .where('id', 'at-bulk-a')
        .first()
      const refresh = await fkDb('oauthRefreshToken')
        .where('id', 'rt-bulk-a')
        .first()
      expect(access).toBeDefined()
      expect(access?.sessionId).toBeNull()
      expect(refresh).toBeDefined()
      expect(refresh?.sessionId).toBeNull()
    })

    it('deleteMany() is a no-op returning 0 when no session matches', async () => {
      await seedSessionWithTokens('survivor')

      const count = await fkAdapter.deleteMany({
        model: 'sessions',
        where: [{ field: 'token', value: 'missing', operator: 'eq' as const }]
      })

      expect(count).toBe(0)
      // The unrelated session and its (still-attached) tokens are untouched.
      expect(
        await fkDb('sessions').where('token', 'survivor').first()
      ).toBeDefined()
      expect(
        (await fkDb('oauthAccessToken').where('id', 'at-survivor').first())
          ?.sessionId
      ).toBe('sid-survivor')
    })
  })

  describe('count', () => {
    beforeEach(async () => {
      await db('users').insert([
        { id: 'u1', email: 'a@test.com' },
        { id: 'u2', email: 'b@test.com' },
        { id: 'u3', email: 'c@test.com' }
      ])
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
      await db('users').insert([
        { id: 'u1', display_name: 'Alice', email: 'alice@test.com' },
        { id: 'u2', display_name: 'Bob', email: 'bob@test.com' },
        { id: 'u3', display_name: 'Charlie', email: 'charlie@test.com' }
      ])
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
      }
    ])('$description', async ({ where, expectedIds }) => {
      const results = await adapter.findMany({
        model: 'users',
        where: [where]
      })
      expect(results.map((r: any) => r.id).sort()).toEqual(expectedIds)
    })

    it('escapes LIKE wildcards in contains', async () => {
      await db('users').insert({
        id: 'u4',
        display_name: '100% done',
        email: 'd@test.com'
      })

      const results = await adapter.findMany({
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

  // Better-auth resolves sign-in/sign-up by email through this adapter against
  // the `accounts` (user) table, so the adapter must normalize `accounts.email`
  // on both writes and lookups to keep auth case-insensitive.
  describe('accounts email normalization', () => {
    let accountsDb: Knex
    let accountsAdapter: ReturnType<ReturnType<typeof knexAdapter>>

    beforeAll(async () => {
      accountsDb = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: ':memory:' }
      })
      await accountsDb.schema.createTable('accounts', (table) => {
        table.text('id').primary()
        table.text('email').unique()
        table.text('name')
      })
      accountsAdapter = knexAdapter(accountsDb)({} as never)
    })

    afterAll(async () => {
      await accountsDb.destroy()
    })

    beforeEach(async () => {
      await accountsDb('accounts').delete()
    })

    it('lowercases the email when creating an account', async () => {
      await accountsAdapter.create({
        model: 'accounts',
        data: { id: 'a1', email: 'User.Name@Example.COM' }
      })
      const row = await accountsDb('accounts').where('id', 'a1').first()
      expect(row.email).toBe('user.name@example.com')
    })

    it.each([
      { description: 'an uppercase eq lookup', value: 'USER@EXAMPLE.COM' },
      { description: 'a mixed-case eq lookup', value: 'User@Example.com' }
    ])('finds an account by $description', async ({ value }) => {
      await accountsDb('accounts').insert({
        id: 'a1',
        email: 'user@example.com'
      })
      const result = await accountsAdapter.findOne({
        model: 'accounts',
        where: [{ field: 'email', value, operator: 'eq' as const }]
      })
      expect(result).toMatchObject({ id: 'a1' })
    })

    it('normalizes each entry of an IN lookup on email', async () => {
      await accountsDb('accounts').insert({
        id: 'a1',
        email: 'user@example.com'
      })
      const results = await accountsAdapter.findMany({
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
      await accountsDb('accounts').insert({
        id: 'a1',
        email: 'user@example.com'
      })
      await accountsAdapter.update({
        model: 'accounts',
        where: [{ field: 'id', value: 'a1', operator: 'eq' as const }],
        update: { email: 'New.Address@Example.COM' }
      })
      const row = await accountsDb('accounts').where('id', 'a1').first()
      expect(row.email).toBe('new.address@example.com')
    })

    it('lowercases the email when updating many accounts', async () => {
      await accountsDb('accounts').insert({
        id: 'a1',
        email: 'user@example.com'
      })
      await accountsAdapter.updateMany({
        model: 'accounts',
        where: [{ field: 'id', value: 'a1', operator: 'eq' as const }],
        update: { email: 'Bulk.Update@Example.COM' }
      })
      const row = await accountsDb('accounts').where('id', 'a1').first()
      expect(row.email).toBe('bulk.update@example.com')
    })
  })
})

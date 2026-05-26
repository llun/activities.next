import knex, { Knex } from 'knex'

import { knexAdapter } from './knexAdapter'

jest.mock('better-auth/adapters', () => ({
  createAdapterFactory: ({
    adapter
  }: {
    config: Record<string, unknown>
    adapter: (helpers: {
      getModelName: (model: string) => string
      getFieldName: (opts: { model: string; field: string }) => string
    }) => Record<string, (...args: any[]) => any>
  }) => {
    // Return a factory that, when called, invokes the adapter with
    // identity getModelName/getFieldName (no field remapping).
    return () =>
      adapter({ getModelName: (m) => m, getFieldName: (o) => o.field })
  }
}))

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
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2026-02-04T10:00:00.000Z'))

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
        jest.useRealTimers()
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
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2026-02-04T10:00:00.000Z'))

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
        jest.useRealTimers()
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
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2026-02-04T10:00:00.000Z'))

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
        expect(sessionRow?.accountId).toBe('u-ba-canonical')
      } finally {
        jest.useRealTimers()
      }
    })

    it('creates sessions when login counter recording fails', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
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

    it('not_in operator', async () => {
      const results = await adapter.findMany({
        model: 'users',
        where: [
          {
            field: 'id',
            value: ['u1', 'u3'],
            operator: 'not_in' as const
          }
        ]
      })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('u2')
    })

    it('contains operator (LIKE)', async () => {
      const results = await adapter.findMany({
        model: 'users',
        where: [
          {
            field: 'display_name',
            value: 'li',
            operator: 'contains' as const
          }
        ]
      })
      expect(results).toHaveLength(2)
      expect(results.map((r: any) => r.id).sort()).toEqual(['u1', 'u3'])
    })

    it('starts_with operator', async () => {
      const results = await adapter.findMany({
        model: 'users',
        where: [
          {
            field: 'display_name',
            value: 'Ch',
            operator: 'starts_with' as const
          }
        ]
      })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('u3')
    })

    it('ends_with operator', async () => {
      const results = await adapter.findMany({
        model: 'users',
        where: [
          {
            field: 'email',
            value: '@test.com',
            operator: 'ends_with' as const
          }
        ]
      })
      expect(results).toHaveLength(3)
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
})

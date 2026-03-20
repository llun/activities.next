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
      table.text('token').unique()
      table.timestamp('expires_at')
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

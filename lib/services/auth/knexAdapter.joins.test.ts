import type { JoinConfig } from 'better-auth/adapters'
import { Knex } from 'knex'

import {
  type SessionWithAccount,
  type TestAdapter,
  type UserWithSessions,
  createTestDatabase,
  resetTables
} from './knexAdapter.testUtils'

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
  let adapter: TestAdapter

  beforeAll(async () => {
    ;({ db, adapter } = await createTestDatabase())
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await resetTables(db)
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
    const sessionsJoin: JoinConfig = {
      sessions: {
        on: { from: 'id', to: 'user_id' },
        limit: 100,
        relation: 'one-to-many' as const
      }
    }
    const sessionsLimitedJoin: JoinConfig = {
      sessions: {
        on: { from: 'id', to: 'user_id' },
        limit: 1,
        relation: 'one-to-many' as const
      }
    }
    const accountsJoin: JoinConfig = {
      accounts: {
        on: { from: 'accountId', to: 'id' },
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
      const result = await adapter.findOne<UserWithSessions>({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }],
        join: sessionsJoin
      })

      if (!result) throw new Error('Expected a user row')

      expect(result.sessions.map((row: any) => row.id).sort()).toEqual([
        's1',
        's2'
      ])
    })

    it('bounds a one-to-many join by its per-parent limit', async () => {
      const results = await adapter.findMany<UserWithSessions>({
        model: 'users',
        sortBy: { field: 'id', direction: 'asc' as const },
        join: sessionsLimitedJoin
      })

      // u1 owns two sessions but the limit applies per parent row, which is why
      // this cannot be one joined statement.
      expect(results.map((row) => row.sessions.length)).toEqual([1, 1])
    })

    it('returns an empty array for a one-to-many join with no related rows', async () => {
      await db('sessions').delete()

      const result = await adapter.findOne<UserWithSessions>({
        model: 'users',
        where: [{ field: 'id', value: 'u1', operator: 'eq' as const }],
        join: sessionsJoin
      })

      if (!result) throw new Error('Expected a user row')

      expect(result.sessions).toEqual([])
    })

    it('falls back to a separate query for a table the schema does not describe', async () => {
      await db('accounts').insert({
        id: 'a1',
        user_id: 'u1',
        provider: 'credential'
      })

      const result = await adapter.findOne<SessionWithAccount>({
        model: 'sessions',
        where: [{ field: 'id', value: 's1', operator: 'eq' as const }],
        join: accountsJoin
      })

      if (!result) throw new Error('Expected a session row')

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
})

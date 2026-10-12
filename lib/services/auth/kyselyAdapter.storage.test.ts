import type { BetterAuthOptions } from '@better-auth/core'
import { getAuthTables } from '@better-auth/core/db'
import { sql } from 'kysely'

import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'

// What the adapter stores for better-auth's dates and booleans, read back from
// the database without the driver's normalisation, for every date and boolean
// column of every better-auth table. These are the representations the rest of
// the application reads and orders by, and the ones the Knex adapter stored
// before this one: SQLite holds dates as INTEGER epoch milliseconds (never ISO
// text, which SQLite orders after every integer) and booleans as INTEGER 0/1;
// PostgreSQL holds them as `timestamp with time zone` and `boolean`. Reading
// back through the adapter gives better-auth a `Date` for every column it
// declares as a date, whatever its name — `oauthRefreshToken.revoked` included.
const HOST = 'test.example.com'
const BASE_URL = `https://${HOST}`

const holder = vi.hoisted(() => ({ testDb: null as TestDatabase | null }))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: HOST,
    serviceName: 'Activities.next Test',
    secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
    trustedHosts: [],
    auth: { enableCredential: true }
  }),
  getBaseURL: () => BASE_URL
}))

vi.mock('@/lib/database', () => ({
  getKysely: () => holder.testDb?.db,
  // Null skips the session-create hook's account gate.
  getDatabase: () => null
}))

type Field = {
  type: unknown
  fieldName?: string
  references?: { model: string; field: string }
}
type Model = { modelName: string; fields: Record<string, Field> }
type Row = Record<string, unknown>

// Columns that point at another table without better-auth declaring the
// reference, as model -> field -> [model, field].
const UNDECLARED_REFERENCES: Record<
  string,
  Record<string, [string, string]>
> = {
  oauthClientResource: { resourceId: ['oauthResource', 'identifier'] },
  oauthAccessToken: { refreshId: ['oauthRefreshToken', 'id'] }
}

// Every date written below is a distinct instant with a millisecond part, so a
// representation that drops milliseconds or swaps two columns shows up.
const FIRST_DATE = Date.UTC(2026, 2, 4, 5, 6, 7, 891)
const UPDATED_DATE = Date.UTC(2026, 6, 8, 9, 10, 11, 123)

const getAuthInstance = async () => {
  const { getAuth } = await import('@/lib/services/auth/auth')
  return getAuth(BASE_URL)
}

const db = () => {
  if (!holder.testDb) throw new Error('The test database is not ready')
  return holder.testDb.db
}

const isPostgres = () => holder.testDb?.backend === 'pg'

type Stored = { kind: string; value: string | null }

// One column of one row as the database holds it: SQLite's storage class and
// SQL literal, or PostgreSQL's column type and value (a timestamp as epoch
// milliseconds). Both are expressions, so the driver does not convert them.
const readStored = async (
  table: string,
  id: unknown,
  column: string,
  type: 'date' | 'boolean' = 'date'
): Promise<Stored> => {
  const ref = sql.ref(`${table}.${column}`)
  const postgresValue =
    type === 'date'
      ? sql`(extract(epoch from ${ref}) * 1000)::bigint::text`
      : sql`${ref}::text`
  const query = isPostgres()
    ? sql<Stored>`select pg_typeof(${ref})::text as kind, ${postgresValue} as value
        from ${sql.table(table)} where ${sql.ref(`${table}.id`)} = ${id}`
    : sql<Stored>`select typeof(${ref}) as kind, quote(${ref}) as value
        from ${sql.table(table)} where ${sql.ref(`${table}.id`)} = ${id}`
  const { rows } = await query.execute(db())
  if (rows.length !== 1) throw new Error(`No ${table} row ${String(id)}`)
  return rows[0]
}

const expectedDate = (time: number): Stored =>
  isPostgres()
    ? { kind: 'timestamp with time zone', value: String(time) }
    : { kind: 'integer', value: String(time) }

const expectedBoolean = (value: boolean): Stored =>
  isPostgres()
    ? { kind: 'boolean', value: String(value) }
    : { kind: 'integer', value: value ? '1' : '0' }

describe('kyselyAdapter storage', () => {
  let tables: Record<string, Model>
  let adapter: Awaited<
    ReturnType<typeof getAuthInstance>
  >['$context'] extends Promise<infer C>
    ? C extends { adapter: infer A }
      ? A
      : never
    : never
  // The record each model's create returned, keyed by model.
  const created = new Map<string, Row>()

  const findModel = (name: string): [string, Model] => {
    const entry = Object.entries(tables).find(
      ([key, model]) => key === name || model.modelName === name
    )
    if (!entry) throw new Error(`Unknown better-auth model ${name}`)
    return entry
  }

  const referenceOf = (
    model: string,
    field: string,
    attributes: Field
  ): [string, string] | null => {
    if (attributes.references) {
      return [
        findModel(attributes.references.model)[0],
        attributes.references.field
      ]
    }
    return UNDECLARED_REFERENCES[model]?.[field] ?? null
  }

  const valueFor = (
    model: string,
    field: string,
    attributes: Field,
    index: number
  ) => {
    const reference = referenceOf(model, field, attributes)
    if (reference) return created.get(reference[0])?.[reference[1]]
    switch (attributes.type) {
      case 'date':
        return new Date(FIRST_DATE + index * 1000)
      case 'boolean':
        return true
      case 'number':
        return 1
      case 'json':
        return { key: 'value' }
      case 'string[]':
        return ['a', 'b']
      case 'number[]':
        return [1, 2]
      default:
        return `${model}-${field}`
    }
  }

  const columnsOfType = (model: string, type: string) =>
    Object.entries(tables[model].fields)
      .filter(([, attributes]) => attributes.type === type)
      .map(([field, attributes]) => ({
        field,
        column: attributes.fieldName ?? field
      }))

  beforeAll(async () => {
    const testDb = createTestDatabase()
    await testDb.prepare()
    await testDb.database.migrate()
    holder.testDb = testDb

    const auth = await getAuthInstance()
    // A concrete instance's `options` carries its plugin list as a literal
    // tuple, which better-auth's plugin-registry generics make invariant
    // against the general `BetterAuthOptions`; the cast is the type system.
    tables = getAuthTables(auth.options as BetterAuthOptions) as Record<
      string,
      Model
    >
    adapter = (await auth.$context).adapter

    // Create one record per model, each after the models it references.
    const pending = new Set(Object.keys(tables))
    while (pending.size > 0) {
      const ready = [...pending].filter((model) =>
        Object.entries(tables[model].fields).every(([field, attributes]) => {
          const reference = referenceOf(model, field, attributes)
          return !reference || created.has(reference[0])
        })
      )
      if (ready.length === 0) {
        throw new Error(`Unresolvable references: ${[...pending].join(', ')}`)
      }
      for (const model of ready) {
        const data = Object.fromEntries(
          Object.entries(tables[model].fields).map(
            ([field, attributes], index) => [
              field,
              valueFor(model, field, attributes, index)
            ]
          )
        )
        created.set(
          model,
          (await adapter.create({ model, data })) as unknown as Row
        )
        pending.delete(model)
      }
    }
  })

  afterAll(async () => {
    await holder.testDb?.destroy()
  })

  it('covers every better-auth table that has a date or boolean column', () => {
    const covered = Object.keys(tables).filter(
      (model) =>
        columnsOfType(model, 'date').length > 0 ||
        columnsOfType(model, 'boolean').length > 0
    )
    // The tables the pins below cover; a new one fails here first.
    expect(covered.sort()).toEqual(
      [
        'account',
        'jwks',
        'oauthAccessToken',
        'oauthClient',
        'oauthClientAssertion',
        'oauthClientResource',
        'oauthConsent',
        'oauthRefreshToken',
        'oauthResource',
        'passkey',
        'session',
        'twoFactor',
        'user',
        'verification'
      ].sort()
    )
  })

  it('stores each date as epoch milliseconds on SQLite and timestamptz on PostgreSQL', async () => {
    for (const model of Object.keys(tables)) {
      const record = created.get(model) as Row
      const fields = Object.keys(tables[model].fields)
      for (const { field, column } of columnsOfType(model, 'date')) {
        const time = FIRST_DATE + fields.indexOf(field) * 1000
        expect({
          model,
          field,
          stored: await readStored(tables[model].modelName, record.id, column)
        }).toEqual({ model, field, stored: expectedDate(time) })
      }
    }
  })

  it('stores each boolean as 0/1 on SQLite and boolean on PostgreSQL', async () => {
    for (const model of Object.keys(tables)) {
      const record = created.get(model) as Row
      for (const { field, column } of columnsOfType(model, 'boolean')) {
        expect({
          model,
          field,
          stored: await readStored(
            tables[model].modelName,
            record.id,
            column,
            'boolean'
          )
        }).toEqual({ model, field, stored: expectedBoolean(true) })
      }
    }
  })

  it('hands better-auth a Date for each date and a boolean for each boolean', async () => {
    for (const model of Object.keys(tables)) {
      const record = created.get(model) as Row
      const read = (await adapter.findOne({
        model,
        where: [{ field: 'id', value: record.id as string }]
      })) as Row
      const fields = Object.keys(tables[model].fields)
      for (const { field } of columnsOfType(model, 'date')) {
        const time = FIRST_DATE + fields.indexOf(field) * 1000
        expect({ model, field, value: read[field] }).toEqual({
          model,
          field,
          value: new Date(time)
        })
      }
      for (const { field } of columnsOfType(model, 'boolean')) {
        expect({ model, field, value: read[field] }).toEqual({
          model,
          field,
          value: true
        })
      }
    }
  })

  it('stores updated dates and booleans the same way', async () => {
    for (const model of Object.keys(tables)) {
      const dates = columnsOfType(model, 'date')
      const booleans = columnsOfType(model, 'boolean')
      if (dates.length === 0 && booleans.length === 0) continue
      const record = created.get(model) as Row
      await adapter.update({
        model,
        where: [{ field: 'id', value: record.id as string }],
        update: Object.fromEntries([
          ...dates.map(({ field }) => [field, new Date(UPDATED_DATE)]),
          ...booleans.map(({ field }) => [field, false])
        ])
      })
      for (const { field, column } of dates) {
        expect({
          model,
          field,
          stored: await readStored(tables[model].modelName, record.id, column)
        }).toEqual({ model, field, stored: expectedDate(UPDATED_DATE) })
      }
      for (const { field, column } of booleans) {
        expect({
          model,
          field,
          stored: await readStored(
            tables[model].modelName,
            record.id,
            column,
            'boolean'
          )
        }).toEqual({ model, field, stored: expectedBoolean(false) })
      }
    }
  })

  it('stamps the serving host onto a new passkey', async () => {
    const passkey = created.get('passkey') as Row
    const row = await db()
      .selectFrom('passkey')
      .select('rpID')
      .where('id', '=', passkey.id as string)
      .executeTakeFirst()
    expect(row?.rpID).toBe(HOST)
  })

  // Refresh-token rotation, as @better-auth/oauth-provider runs it: revoke the
  // old token with an incrementOne guarded by `revoked eq null`, which only
  // the first of two rotations may pass. `revoked` is a date column without
  // the `At` suffix, so it must still come back as a Date, and be stored like
  // every other date.
  it('round-trips oauthRefreshToken.revoked as a Date through rotation', async () => {
    const source = created.get('oauthRefreshToken') as Row
    const token = (await adapter.create({
      model: 'oauthRefreshToken',
      data: {
        token: 'rotation-token',
        clientId: source.clientId,
        userId: source.userId,
        scopes: ['read'],
        createdAt: new Date(FIRST_DATE),
        expiresAt: new Date(UPDATED_DATE)
      }
    })) as Row
    expect(token.revoked ?? null).toBeNull()

    const rotatedAt = new Date(FIRST_DATE + 60_000)
    const rotate = () =>
      adapter.incrementOne<Row>({
        model: 'oauthRefreshToken',
        where: [
          { field: 'id', value: token.id as string },
          { field: 'revoked', operator: 'eq', value: null }
        ],
        increment: {},
        set: { revoked: rotatedAt, rotatedAt }
      })

    const rotated = await rotate()
    expect(rotated?.revoked).toEqual(rotatedAt)
    expect(rotated?.rotatedAt).toEqual(rotatedAt)
    // The replay finds the token already revoked.
    expect(await rotate()).toBeNull()

    const read = (await adapter.findOne({
      model: 'oauthRefreshToken',
      where: [{ field: 'id', value: token.id as string }]
    })) as Row
    expect(read.revoked).toBeInstanceOf(Date)
    expect(read.revoked).toEqual(rotatedAt)
    expect(await readStored('oauthRefreshToken', token.id, 'revoked')).toEqual(
      expectedDate(rotatedAt.getTime())
    )
  })
})

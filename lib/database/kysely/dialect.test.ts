import knex from 'knex'

import { kyselyFor } from '@/lib/database/kysely'
import {
  forUpdate,
  getDialectName,
  timestampValue
} from '@/lib/database/kysely/dialect'

// Compiles only: neither instance connects.
const sqlite = knex({
  client: 'better-sqlite3',
  useNullAsDefault: true,
  connection: { filename: ':memory:' }
})
const postgres = knex({ client: 'pg', connection: {} })

afterAll(async () => {
  await Promise.all([sqlite.destroy(), postgres.destroy()])
})

describe('getDialectName', () => {
  it('names each backend', () => {
    expect(getDialectName(kyselyFor(sqlite))).toBe('sqlite')
    expect(getDialectName(kyselyFor(postgres))).toBe('postgres')
  })
})

describe('forUpdate', () => {
  it.each([
    { name: 'sqlite', instance: sqlite, suffix: '' },
    { name: 'postgres', instance: postgres, suffix: ' for update' }
  ])('locks rows only where the backend supports it ($name)', (item) => {
    const db = kyselyFor(item.instance)
    const query = forUpdate(db, db.selectFrom('likes').select('statusId'))
    expect(query.compile().sql).toMatch(
      new RegExp(`from "likes"${item.suffix}$`)
    )
  })
})

describe('timestampValue', () => {
  it('binds a Date for epoch milliseconds and for a Date', () => {
    const db = kyselyFor(sqlite)
    const at = new Date('2026-04-01T00:00:00.000Z')
    const compiled = db
      .selectFrom('likes')
      .select('statusId')
      .where('createdAt', '<', timestampValue(at.getTime()))
      .where('updatedAt', '<', timestampValue(at))
      .compile()
    expect(compiled.parameters).toEqual([at, at])
  })
})

describe('timestamp column types', () => {
  it('rejects a bare number as a comparison operand', () => {
    const db = kyselyFor(sqlite)
    // A bare number fails on PostgreSQL, so the column reads as a branded
    // EpochMs, which stops bare numbers (read-back values still type-check, so
    // they must go through timestampValue() too).
    db.selectFrom('likes')
      .select('statusId')
      // @ts-expect-error a plain number is not an EpochMs
      .where('createdAt', '<', 123)
      .compile()
  })
})

// Result normalisation for the Knex-backed Kysely driver, so code written
// against Kysely gets one representation per column type on both backends and
// never needs getCompatibleTime / getCompatibleJSON / Number() shims:
//
// | column type          | PostgreSQL (node-postgres)  | SQLite (better-sqlite3)     | returned as        |
// | -------------------- | --------------------------- | --------------------------- | ------------------ |
// | timestamp(tz)        | Date                        | epoch ms, or 'YYYY-MM-DD    | epoch ms number    |
// | / datetime           |                             | HH:MM:SS' UTC text          |                    |
// | int8, numeric        | string                      | number                      | number (int8 must  |
// |                      |                             |                             | be a safe integer) |
// | boolean              | boolean                     | 0 / 1                       | boolean            |
// | json, jsonb          | parsed                      | JSON text                   | parsed             |
// | date                 | Date (local midnight)       | whatever was written        | as written: text   |
//
// PostgreSQL is normalised with per-query type parsers (never the global
// `pg.types`, which Knex relies on); SQLite from each statement's declared
// column types, which better-sqlite3 reports through aliases. Expression
// columns (`count(*)`, `max(...)`) have no declared type on SQLite and come
// back as SQLite produced them: a domain mapper converts those itself.
//
// Bindings on SQLite are encoded exactly like Knex's better-sqlite3
// `_formatBindings` (Date -> epoch ms, boolean -> 0/1), so rows written by
// either library compare and sort the same. Never bind ISO strings for
// timestamps: SQLite orders INTEGER before TEXT, so cursors would misorder.

// Same rule as getCompatibleTime: SQLite's CURRENT_TIMESTAMP default writes
// UTC text without a zone designator.
const SQLITE_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/

export const toEpochMilliseconds = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Date) return value.getTime()
  const trimmed = String(value).trim()
  const normalized = SQLITE_UTC_TIMESTAMP_PATTERN.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed
  return new Date(normalized).getTime()
}

export const toSqliteBinding = (value: unknown) => {
  if (value instanceof Date) return value.valueOf()
  if (typeof value === 'boolean') return Number(value)
  return value
}

type SqliteColumn = { name: string; type: string | null }
type Converter = (value: unknown) => unknown

const toBoolean: Converter = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value !== '0' && value !== ''
  return Boolean(value)
}

const parseJson: Converter = (value) => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    // Not JSON after all (hand-written data); hand back what is stored.
    return value
  }
}

const getSqliteConverter = (declaredType: string | null): Converter | null => {
  const type = (declaredType ?? '').toLowerCase().replace(/\(.*$/, '').trim()
  switch (type) {
    case 'datetime':
    case 'timestamp':
      return toEpochMilliseconds
    case 'boolean':
      return toBoolean
    case 'json':
    case 'jsonb':
      return parseJson
    default:
      return null
  }
}

export const normalizeSqliteRows = (
  rows: Record<string, unknown>[],
  columns: SqliteColumn[]
) => {
  // A row object keeps the LAST column of a repeated name, so its converter
  // is the one that applies.
  const converters = new Map<string, Converter | null>()
  for (const column of columns) {
    converters.set(column.name, getSqliteConverter(column.type))
  }
  const active = [...converters].filter(
    (entry): entry is [string, Converter] => entry[1] !== null
  )
  if (active.length === 0) return rows
  for (const row of rows) {
    for (const [name, convert] of active) {
      row[name] = convert(row[name])
    }
  }
  return rows
}

type TypeParser = (value: string) => unknown

export type PostgresTypes = {
  getTypeParser(oid: number, format?: string): TypeParser
}

// node-postgres type OIDs (pg_type.oid).
const PG_INT8 = 20
const PG_DATE = 1082
const PG_TIMESTAMP = 1114
const PG_TIMESTAMPTZ = 1184
const PG_NUMERIC = 1700

// Knex returns int8 as an exact string; Number() would round anything above
// 2^53 - 1 silently, which would surface as wrong cursors or lookups.
export const parseInt8 = (value: string): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(
      `PostgreSQL bigint value ${value} is outside the safe integer range ` +
        '(±9007199254740991) and cannot be read as a number'
    )
  }
  return parsed
}

export const createPostgresTypeParsers = (
  defaults: PostgresTypes
): PostgresTypes => ({
  getTypeParser(oid, format) {
    switch (oid) {
      case PG_TIMESTAMP:
      case PG_TIMESTAMPTZ: {
        const parse = defaults.getTypeParser(oid, format)
        return (value) => toEpochMilliseconds(parse(value))
      }
      case PG_INT8:
        return parseInt8
      case PG_NUMERIC:
        return (value) => Number(value)
      case PG_DATE:
        return (value) => value
      default:
        return defaults.getTypeParser(oid, format)
    }
  }
})

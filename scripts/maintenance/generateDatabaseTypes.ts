#!/usr/bin/env -S node scripts/run.cjs
// Regenerates lib/database/kysely/db.ts, the Kysely `DB` interface for every
// application table.
//
// The PostgreSQL schema comes from a live database that is migrated to the
// latest migration (configured with the same inline ACTIVITIES_DATABASE_*
// settings `yarn migrate` takes); the SQLite schema comes from loading the
// committed migrations/schema.sqlite.sql into an in-memory database. Both are
// read with Kysely's own introspection through lib/database/kysely, and each
// column is typed so the value is honest on BOTH backends — see the header
// emitted below and docs/setup.md ("Regenerating the Kysely DB types").
//
// Usage:
//   ACTIVITIES_DATABASE= ACTIVITIES_DATABASE_CLIENT=pg \
//   ACTIVITIES_DATABASE_PG_HOST=… ACTIVITIES_DATABASE_PG_PORT=… \
//   ACTIVITIES_DATABASE_PG_USER=… ACTIVITIES_DATABASE_PG_PASSWORD=… \
//   ACTIVITIES_DATABASE_PG_DATABASE=… \
//     node scripts/run.cjs scripts/maintenance/generateDatabaseTypes.ts \
//       [--output lib/database/kysely/db.ts]
//
// It only reads the schema; it never writes to either database.
import knex, { Knex } from 'knex'
import type { ColumnMetadata, TableMetadata } from 'kysely'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as prettier from 'prettier'

import { getDatabaseConfig } from '@/lib/config/database'
import { kyselyFor } from '@/lib/database/kysely'

const DEFAULT_OUTPUT = 'lib/database/kysely/db.ts'
const SQLITE_SCHEMA = 'migrations/schema.sqlite.sql'

// Knex's own bookkeeping tables, and the shadow tables SQLite's FTS5 module
// manages for each full-text index (the virtual table itself is kept).
const EXCLUDED_TABLE =
  /^(knex_migrations(_lock)?|.+_fts_(data|idx|docsize|config|content))$/

// What the Kysely driver hands back for a column (see
// lib/database/kysely/normalize.ts), and what both backends accept when it is
// written.
type Category =
  'string' | 'timestamp' | 'date' | 'number' | 'boolean' | 'json' | 'binary'

const CATEGORY_TYPE: Record<Category, { select: string; insert: string }> = {
  string: { select: 'string', insert: 'string' },
  timestamp: { select: 'EpochMs', insert: 'Date' },
  // node-postgres would parse `date` into a local-midnight Date; the driver
  // keeps it as the 'YYYY-MM-DD' text, which is what the app writes.
  date: { select: 'string', insert: 'string' },
  number: { select: 'number', insert: 'number' },
  boolean: { select: 'boolean', insert: 'boolean' },
  // Written as a JSON string: node-postgres turns a JS array into a
  // PostgreSQL array literal, not JSON.
  json: { select: 'unknown', insert: 'string' },
  binary: { select: 'Buffer', insert: 'Buffer' }
}

// Named aliases in the generated file for the categories whose select and
// insert types differ.
const CATEGORY_ALIAS: Partial<Record<Category, string>> = {
  timestamp: 'Timestamp',
  json: 'Json'
}

const postgresCategory = (dataType: string): Category => {
  switch (dataType) {
    case 'varchar':
    case 'text':
    case 'bpchar':
    case 'uuid':
    case 'citext':
      return 'string'
    case 'timestamptz':
    case 'timestamp':
      return 'timestamp'
    case 'date':
      return 'date'
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
      return 'number'
    case 'bool':
      return 'boolean'
    case 'json':
    case 'jsonb':
      return 'json'
    case 'bytea':
      return 'binary'
    default:
      throw new Error(`No type mapping for PostgreSQL type "${dataType}"`)
  }
}

const sqliteCategory = (tableName: string, declared: string): Category => {
  const type = declared.toLowerCase().replace(/\(.*\)$/, '')
  // FTS5 virtual table columns carry no declared type; they hold text.
  if (type === '' && tableName.endsWith('_fts')) return 'string'
  switch (type) {
    case 'varchar':
    case 'text':
    case 'char':
    case 'uuid':
      return 'string'
    case 'datetime':
    case 'timestamp':
      return 'timestamp'
    case 'date':
      return 'date'
    case 'integer':
    case 'int':
    case 'smallint':
    case 'bigint':
    case 'float':
    case 'real':
    case 'double':
    case 'decimal':
    case 'numeric':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'json':
    case 'jsonb':
      return 'json'
    case 'blob':
      return 'binary'
    default:
      throw new Error(
        `No type mapping for SQLite type "${declared}" on ${tableName}`
      )
  }
}

type ColumnShape = {
  categories: Category[]
  nullable: boolean
  hasDefault: boolean
  note?: string
}

const unique = (values: string[]) => [...new Set(values)]

const renderType = (shape: ColumnShape) => {
  const categories = unique(shape.categories) as Category[]
  let base: string
  if (categories.length === 1) {
    const [category] = categories
    base = CATEGORY_ALIAS[category] ?? CATEGORY_TYPE[category].select
  } else {
    // The backends disagree (reported as a mismatch): accept either.
    const select = unique(categories.map((c) => CATEGORY_TYPE[c].select))
    const insert = unique(categories.map((c) => CATEGORY_TYPE[c].insert))
    base = `ColumnType<${select.join(' | ')}, ${insert.join(' | ')}, ${insert.join(' | ')}>`
  }
  if (shape.nullable) base = `Nullable<${base}>`
  if (shape.hasDefault) base = `WithDefault<${base}>`
  return base
}

const toInterfaceName = (tableName: string) =>
  tableName
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')

const byName = <T extends { name: string }>(items: readonly T[]) =>
  new Map(items.map((item) => [item.name, item]))

const mismatches: string[] = []

const mergeColumn = (
  tableName: string,
  pg: ColumnMetadata | undefined,
  sqlite: ColumnMetadata | undefined
): ColumnShape => {
  if (pg && sqlite) {
    const pgCategory = postgresCategory(pg.dataType)
    const sqliteCategoryValue = sqliteCategory(tableName, sqlite.dataType)
    if (pgCategory !== sqliteCategoryValue) {
      mismatches.push(
        `${tableName}.${pg.name}: PostgreSQL ${pg.dataType} (${pgCategory}), ` +
          `SQLite ${sqlite.dataType} (${sqliteCategoryValue})`
      )
    }
    return {
      categories: [pgCategory, sqliteCategoryValue],
      // Knex's SQLite DDL drops NOT NULL from primary keys, so SQLite reports
      // every primary key as nullable. PostgreSQL enforces the constraint the
      // migrations declare, so it decides nullability.
      nullable: pg.isNullable,
      // A value may be omitted on insert only if BOTH backends fill it in.
      hasDefault:
        (pg.hasDefaultValue || pg.isAutoIncrementing) &&
        (sqlite.hasDefaultValue || sqlite.isAutoIncrementing),
      note:
        pgCategory === sqliteCategoryValue
          ? undefined
          : `Mismatch: PostgreSQL ${pg.dataType}, SQLite ${sqlite.dataType}.`
    }
  }
  const only = (pg ?? sqlite) as ColumnMetadata
  return {
    categories: [
      pg
        ? postgresCategory(only.dataType)
        : sqliteCategory(tableName, only.dataType)
    ],
    nullable: only.isNullable,
    hasDefault: only.hasDefaultValue || only.isAutoIncrementing,
    note: pg ? 'Exists only on PostgreSQL.' : 'Exists only on SQLite.'
  }
}

const renderTable = (
  name: string,
  pg: TableMetadata | undefined,
  sqlite: TableMetadata | undefined
) => {
  const pgColumns = byName(pg?.columns ?? [])
  const sqliteColumns = byName(sqlite?.columns ?? [])
  const columnNames = unique([
    ...pgColumns.keys(),
    ...sqliteColumns.keys()
  ]).sort()
  const lines: string[] = []
  if (!pg) {
    lines.push(
      '/** Exists only on SQLite; guard every query on it with a SQLite check. */'
    )
  } else if (!sqlite) {
    lines.push(
      '/** Exists only on PostgreSQL; guard every query on it with a PostgreSQL check. */'
    )
  }
  lines.push(`export interface ${toInterfaceName(name)} {`)
  for (const columnName of columnNames) {
    const shape = mergeColumn(
      name,
      pgColumns.get(columnName),
      sqliteColumns.get(columnName)
    )
    // A column on one backend only is not there to read on the other.
    const onBothBackends =
      !pg ||
      !sqlite ||
      (pgColumns.has(columnName) && sqliteColumns.has(columnName))
    // A table on one backend already says so once, above the interface.
    if (shape.note && pg && sqlite) lines.push(`  /** ${shape.note} */`)
    const type = renderType(
      onBothBackends ? shape : { ...shape, nullable: true }
    )
    lines.push(`  ${JSON.stringify(columnName)}: ${type}`)
  }
  lines.push('}')
  return lines.join('\n')
}

const HEADER = `// GENERATED FILE — do not edit by hand.
// Regenerate with scripts/maintenance/generateDatabaseTypes.ts whenever a
// migration changes the schema (see docs/setup.md, "Regenerating the Kysely DB
// types"). CI's PostgreSQL Schema Dump Sync job fails when this file drifts.
//
// The select side is what the Knex-backed Kysely driver returns on BOTH
// backends after normalisation (lib/database/kysely/normalize.ts); the
// insert/update side is what both backends accept:
// - Timestamp: read as epoch milliseconds (branded as EpochMs), written as a
//   Date. Compare a timestamp column only through timestampValue() from
//   lib/database/kysely/dialect.ts: the brand stops bare numbers (PostgreSQL
//   rejects them), not read-back values, which must go through it too.
// - booleans, int8 and numeric read as boolean and number.
// - Json: read parsed, written as a JSON string.
// - Nullable<T> adds null; WithDefault<T> makes the column optional on insert
//   because both backends fill it in.
// - "Mismatch" marks a column whose type differs between
//   migrations/schema.sql and migrations/schema.sqlite.sql in a way that
//   changes what is read back; it is typed as either.
import type { ColumnType, InsertType, SelectType, UpdateType } from 'kysely'

// A plain number is not assignable to EpochMs, so comparing one fails to compile.
export type EpochMs = number & { readonly __brand: 'EpochMs' }
export type Timestamp = ColumnType<EpochMs, Date, Date>
export type Json = ColumnType<unknown, string, string>
export type Nullable<T> = ColumnType<
  SelectType<T> | null,
  InsertType<T> | null,
  UpdateType<T> | null
>
export type WithDefault<T> = ColumnType<
  SelectType<T>,
  InsertType<T> | undefined,
  UpdateType<T>
>
`

const parseOutput = (argv: string[]) => {
  const index = argv.indexOf('--output')
  if (index === -1) return DEFAULT_OUTPUT
  const value = argv[index + 1]
  if (!value) throw new Error('--output needs a path')
  return value
}

const introspect = async (instance: Knex) => {
  const tables = await kyselyFor(instance).introspection.getTables()
  return tables.filter(
    (table) =>
      !table.isView &&
      !EXCLUDED_TABLE.test(table.name) &&
      (table.schema === undefined || table.schema === 'public')
  )
}

const loadSqliteTables = async () => {
  const instance = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  try {
    const connection = await instance.client.acquireConnection()
    try {
      connection.exec(readFileSync(SQLITE_SCHEMA, 'utf8'))
    } finally {
      await instance.client.releaseConnection(connection)
    }
    return await introspect(instance)
  } finally {
    await instance.destroy()
  }
}

const loadPostgresTables = async () => {
  const config = getDatabaseConfig()?.database
  const client = String(config?.client ?? '')
  if (!config || client !== 'pg') {
    throw new Error(
      'Point ACTIVITIES_DATABASE_CLIENT=pg and ACTIVITIES_DATABASE_PG_* at a ' +
        'local PostgreSQL database migrated to the latest migration'
    )
  }
  const instance = knex(config)
  try {
    return await introspect(instance)
  } finally {
    await instance.destroy()
  }
}

const main = async () => {
  const output = resolve(parseOutput(process.argv.slice(2)))
  const [pgTables, sqliteTables] = await Promise.all([
    loadPostgresTables(),
    loadSqliteTables()
  ])
  const pgByName = byName(pgTables)
  const sqliteByName = byName(sqliteTables)
  const tableNames = unique([...pgByName.keys(), ...sqliteByName.keys()]).sort()

  const tables = tableNames.map((name) =>
    renderTable(name, pgByName.get(name), sqliteByName.get(name))
  )
  const db = [
    'export interface DB {',
    ...tableNames.map((name) => `  ${name}: ${toInterfaceName(name)}`),
    '}'
  ].join('\n')

  const source = [HEADER, ...tables, db].join('\n\n')
  // Resolve the repository's Prettier config from the checked-in location even
  // when writing elsewhere (CI writes to a temp file and diffs), so the output
  // is formatted exactly as `yarn prettier` would leave the committed file.
  const prettierConfig =
    (await prettier.resolveConfig(resolve(DEFAULT_OUTPUT))) ?? {}
  const formatted = await prettier.format(source, {
    ...prettierConfig,
    filepath: output
  })
  writeFileSync(output, formatted)
  console.log(`Wrote ${tableNames.length} tables to ${output}`)
  if (mismatches.length > 0) {
    console.warn(
      `${mismatches.length} column(s) differ between the PostgreSQL and SQLite schemas in what they read back:`
    )
    for (const mismatch of mismatches) console.warn(`  ${mismatch}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

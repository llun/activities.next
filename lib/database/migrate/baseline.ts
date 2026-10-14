import { type Kysely, PostgresAdapter, SqliteAdapter, sql } from 'kysely'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { LEGACY_KNEX_MIGRATIONS } from '@/lib/database/migrate/legacyKnexMigrations'

// The handover from Knex to the Kysely migrations, run by the first migration
// (migrations/20261014000000_baseline.ts) under the migrator's lock, and read
// without writing anything by `getMigrationStatus` (lib/database/migrate) so
// `yarn migrate` can refuse before it creates its own tables.
//
// - `knex_migrations` holds exactly the frozen Knex migrations
//   (legacyKnexMigrations.ts, compared without the file extension): the
//   schema is the baseline already, so the baseline is recorded and no DDL
//   runs.
// - `knex_migrations` is missing some of them, has others, or Knex's lock is
//   held: refused, naming the last release with Knex migrations.
// - No `knex_migrations` and no application tables: the baseline schema
//   (migrations/baseline/<backend>.sql) is loaded.
// - No `knex_migrations` but application tables: refused, the schema is
//   unknown.
//
// `knex_migrations` and `knex_migrations_lock` are never changed or dropped,
// so a pre-handover image still finds every Knex migration applied.

/** The last release that ran Knex migrations (and has all of them). */
export const LAST_KNEX_RELEASE = 'v1.192.34'

/** The name of the first migration, which holds the handover. */
export const BASELINE_MIGRATION = '20261014000000_baseline'

const HANDOVER_DOCS = 'docs/maintenance.md, "Upgrading past the Knex handover"'

const KNEX_MIGRATIONS = 'knex_migrations'
const KNEX_MIGRATIONS_LOCK = 'knex_migrations_lock'
// What tells an application database from an empty one.
const APPLICATION_TABLES = ['accounts', 'actors']

export type MigrationBackend = 'sqlite' | 'pg'

export type HandoverRefusal =
  'knex-locked' | 'knex-missing' | 'knex-unknown' | 'unknown-schema'

/** Where a database stands before the baseline is recorded. */
export type HandoverState =
  /** Every Knex migration is applied: the baseline is recorded, no DDL. */
  | { kind: 'knex-complete' }
  /** An empty database: the baseline schema is loaded. */
  | { kind: 'empty' }
  /** `yarn migrate` refuses this database; `message` says what to do. */
  | { kind: 'refused'; reason: HandoverRefusal; message: string }

/** The backend `db` runs on, from its dialect adapter. */
// oxlint-disable-next-line typescript/no-explicit-any
export const getMigrationBackend = (db: Kysely<any>): MigrationBackend => {
  const adapter = db.getExecutor().adapter
  if (adapter instanceof PostgresAdapter) return 'pg'
  if (adapter instanceof SqliteAdapter) return 'sqlite'
  throw new Error('Migrations run on SQLite or PostgreSQL only')
}

/**
 * Whether `tableName` exists where the unqualified name resolves: the
 * current schema on PostgreSQL, the main database on SQLite.
 */
export const tableExists = async (
  // oxlint-disable-next-line typescript/no-explicit-any
  db: Kysely<any>,
  tableName: string
): Promise<boolean> => {
  const { rows } =
    getMigrationBackend(db) === 'pg'
      ? await sql`
          select 1 from information_schema.tables
          where table_name = ${tableName} and table_schema = current_schema()
        `.execute(db)
      : await sql`
          select 1 from sqlite_master
          where type = 'table' and name = ${tableName}
        `.execute(db)
  return rows.length > 0
}

const withoutExtension = (name: string) => name.replace(/\.(c|m)?[jt]s$/, '')

/**
 * Whether `names` are exactly the frozen Knex migrations (in any order, with
 * or without their file extension): a database or an archive at the baseline.
 */
export const isCompleteKnexMigrationList = (names: readonly string[]) => {
  const applied = new Set(names.map(withoutExtension))
  return (
    applied.size === LEGACY_KNEX_MIGRATIONS.length &&
    LEGACY_KNEX_MIGRATIONS.every((name) => applied.has(withoutExtension(name)))
  )
}

const refused = (reason: HandoverRefusal, message: string): HandoverState => ({
  kind: 'refused',
  reason,
  message
})

/**
 * Reads where the database stands for the handover. Read-only: it only
 * selects, so `yarn migrate:status` and the pre-check in `migrateToLatest`
 * can call it on a database the migrator has not touched.
 */
export const readHandoverState = async (
  // oxlint-disable-next-line typescript/no-explicit-any
  db: Kysely<any>
): Promise<HandoverState> => {
  if (await tableExists(db, KNEX_MIGRATIONS)) {
    if (await tableExists(db, KNEX_MIGRATIONS_LOCK)) {
      const { rows } = await sql<{ count: number | string }>`
        select count(*) as count from ${sql.table(KNEX_MIGRATIONS_LOCK)}
        where is_locked = 1
      `.execute(db)
      if (Number(rows[0]?.count ?? 0) > 0) {
        return refused(
          'knex-locked',
          'knex_migrations_lock is locked: a Knex migration run is in ' +
            'progress, or one was interrupted. Let it finish; if none is ' +
            `running, unlock it from a ${LAST_KNEX_RELEASE} checkout with ` +
            '`yarn knex migrate:unlock`, then run `yarn migrate` there and ' +
            `here again (${HANDOVER_DOCS}).`
        )
      }
    }

    const { rows } = await sql<{ name: unknown }>`
      select name from ${sql.table(KNEX_MIGRATIONS)}
    `.execute(db)
    const applied = new Set(
      rows
        .map((row) => row.name)
        .filter((name): name is string => typeof name === 'string')
        .map(withoutExtension)
    )
    const frozen = new Set(LEGACY_KNEX_MIGRATIONS.map(withoutExtension))
    const missing = [...frozen].filter((name) => !applied.has(name))
    const unknown = [...applied].filter((name) => !frozen.has(name)).sort()

    if (missing.length > 0) {
      return refused(
        'knex-missing',
        `This database has not applied ${missing.length} of the ` +
          `${frozen.size} Knex migrations this release starts from (the ` +
          `first missing one is ${missing[0]}). Upgrade to ` +
          `${LAST_KNEX_RELEASE} (the last release with Knex migrations), ` +
          'run `yarn migrate` there, then upgrade to this release and run ' +
          `\`yarn migrate\` again (${HANDOVER_DOCS}).` +
          (unknown.length > 0
            ? ` It has also applied ${unknown.length} Knex migration(s) no ` +
              `release has (the first is ${unknown[0]}).`
            : '')
      )
    }
    if (unknown.length > 0) {
      return refused(
        'knex-unknown',
        `This database has applied ${unknown.length} Knex migration(s) ` +
          `that ${LAST_KNEX_RELEASE}, the last release with Knex ` +
          `migrations, does not have (the first is ${unknown[0]}), so its ` +
          'schema may not be the baseline. It was migrated by another ' +
          'build; the baseline is not recorded over it ' +
          `(${HANDOVER_DOCS}).`
      )
    }
    return { kind: 'knex-complete' }
  }

  const existing: string[] = []
  for (const table of APPLICATION_TABLES) {
    if (await tableExists(db, table)) existing.push(table)
  }
  if (existing.length > 0) {
    return refused(
      'unknown-schema',
      `This database has application tables (${existing.join(', ')}) but ` +
        'no migration history (no knex_migrations and no recorded ' +
        `${BASELINE_MIGRATION}), so its schema is unknown. Neither loading ` +
        `nor recording the baseline over it (${HANDOVER_DOCS}).`
    )
  }
  return { kind: 'empty' }
}

// The baseline schema files, relative to the working directory, as for
// `yarn migrate` (a checkout, or the Docker build stage).
const BASELINE_DIRECTORY = path.join('migrations', 'baseline')

const readBaseline = (backend: MigrationBackend) =>
  readFile(
    path.resolve(
      process.cwd(),
      BASELINE_DIRECTORY,
      backend === 'pg' ? 'postgres.sql' : 'sqlite.sql'
    ),
    'utf8'
  )

const isWordCharacter = (character: string) => /[A-Za-z0-9_$]/.test(character)

/**
 * Splits a SQLite script (the `.schema` dump the baseline is) into its
 * statements, without the `;` that ends them, as SQLite's own
 * `sqlite3_complete` reads it: a `;` inside a string, a quoted identifier or
 * a comment does not end a statement, nor does one inside a
 * `create trigger … begin … end` body before its `end`. Comment-only pieces
 * are dropped.
 */
export const splitSqliteScript = (script: string): string[] => {
  const statements: string[] = []
  let start = 0
  let words: string[] = []
  let index = 0

  const isTrigger = () => {
    const [first, second, third] = words
    return (
      first === 'CREATE' &&
      (second === 'TRIGGER' ||
        ((second === 'TEMP' || second === 'TEMPORARY') && third === 'TRIGGER'))
    )
  }

  while (index < script.length) {
    const character = script[index]
    const next = script[index + 1]
    if (character === '-' && next === '-') {
      const end = script.indexOf('\n', index)
      index = end === -1 ? script.length : end + 1
      // A comment before a statement is not part of it.
      if (words.length === 0) start = index
      continue
    }
    if (character === '/' && next === '*') {
      const end = script.indexOf('*/', index + 2)
      index = end === -1 ? script.length : end + 2
      if (words.length === 0) start = index
      continue
    }
    if (
      character === "'" ||
      character === '"' ||
      character === '`' ||
      character === '['
    ) {
      const close = character === '[' ? ']' : character
      let end = index + 1
      while (end < script.length) {
        if (script[end] === close) {
          // A doubled quote is the quote character itself.
          if (close !== ']' && script[end + 1] === close) {
            end += 2
            continue
          }
          break
        }
        end += 1
      }
      words.push('')
      index = end + 1
      continue
    }
    if (isWordCharacter(character)) {
      let end = index
      while (end < script.length && isWordCharacter(script[end])) end += 1
      words.push(script.slice(index, end).toUpperCase())
      index = end
      continue
    }
    if (character === ';') {
      if (!isTrigger() || words.at(-1) === 'END') {
        if (words.length > 0) {
          statements.push(script.slice(start, index).trim())
        }
        start = index + 1
        words = []
      }
      index += 1
      continue
    }
    index += 1
  }
  if (words.length > 0) statements.push(script.slice(start).trim())
  return statements
}

/**
 * Loads the baseline schema into `db`, a transaction on an empty database. On
 * PostgreSQL the dump runs as one multi-statement query (simple protocol);
 * SQLite runs one statement at a time.
 */
// oxlint-disable-next-line typescript/no-explicit-any
export const loadBaselineSchema = async (db: Kysely<any>) => {
  const backend = getMigrationBackend(db)
  const script = await readBaseline(backend)
  if (backend === 'pg') {
    await sql.raw(script).execute(db)
    return
  }
  for (const statement of splitSqliteScript(script)) {
    await sql.raw(statement).execute(db)
  }
}

/**
 * The baseline migration's `up`: records the baseline on a database every
 * Knex migration ran on, loads it into an empty one, and refuses anything
 * else (see the top of this file).
 */
// oxlint-disable-next-line typescript/no-explicit-any
export const applyBaseline = async (db: Kysely<any>) => {
  const state = await readHandoverState(db)
  if (state.kind === 'refused') throw new Error(state.message)
  if (state.kind === 'empty') await loadBaselineSchema(db)
}

/** The baseline migration's `down`: there is nothing below the baseline. */
export const refuseBaselineRollback = async () => {
  throw new Error(
    `${BASELINE_MIGRATION} cannot be rolled back: it is the first migration, ` +
      'and the schema before it belongs to the Knex migrations.'
  )
}

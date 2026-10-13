import fs from 'fs/promises'
import type { Knex } from 'knex'
import { type Kysely, sql } from 'kysely'
import path from 'path'

import type { DatabaseConfig } from '@/lib/config/database'
import { KNEX_MIGRATIONS } from '@/lib/config/knexfile.js'
import type { DB } from '@/lib/database/kysely'

// The one place outside the migration CLI that runs migrations or asks which
// ones a database has: the facade's `migrate()` and the production archive's
// restore go through here. For now it runs the Knex migrations in
// `migrations/` exactly as `yarn migrate` does (the same directory, Knex's own
// transaction handling), on a Knex instance of its own built from the
// caller's configuration and closed afterwards. Knex is imported on first
// use, and the facade imports this module on first use, so neither Knex nor
// the migrations are part of the app's server bundle.
//
// The names this module reports are what the database's migration table
// holds: today the rows of `knex_migrations` (file names with their `.js`
// extension), in the order they were applied. The production archive stores
// that list in its manifest and compares it on restore, so whatever replaces
// Knex here has to keep restoring an archive whose list is the full set of
// Knex migrations.

/** The database to migrate or inspect, as the caller already has it. */
export type MigrationTarget = {
  /**
   * Kysely on that database. Reads accept a transaction (the production
   * archive asks inside its export snapshot).
   */
  db: Kysely<DB>
  /** The configuration `db` was opened with. */
  config: DatabaseConfig
}

// Where Knex records which migrations ran.
const MIGRATION_TABLE = 'knex_migrations'

/**
 * The migration runner's lock tables. They hold a lock flag, not data, so the
 * production archive neither exports nor restores them.
 */
export const MIGRATION_LOCK_TABLES: readonly string[] = ['knex_migrations_lock']

const tableExists = async (
  { db, config }: MigrationTarget,
  tableName: string
) => {
  const { rows } =
    config.client === 'pg'
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

/**
 * The migrations the database has applied, in the order they ran: the names
 * `knex_migrations` holds. Empty when the database has no migration table.
 */
export const getAppliedMigrationNames = async (
  target: MigrationTarget
): Promise<string[]> => {
  if (!(await tableExists(target, MIGRATION_TABLE))) return []
  const { rows } = await sql<{ name: unknown }>`
    select name from ${sql.table(MIGRATION_TABLE)} order by id asc
  `.execute(target.db)
  return rows
    .map((row) => row.name)
    .filter((name): name is string => typeof name === 'string')
}

/**
 * The migrations this checkout has: the migration files in `migrations/`
 * (relative to the working directory, as for `yarn migrate`), sorted by name.
 */
export const getKnownMigrationNames = async (): Promise<string[]> => {
  const entries = await fs.readdir(
    path.resolve(process.cwd(), KNEX_MIGRATIONS.directory),
    { withFileTypes: true }
  )
  return entries
    .filter((entry) => entry.isFile() && /\.(cjs|js|mjs|ts)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

/**
 * Applies every pending migration, as `yarn migrate` does. The migrations run
 * on a connection of their own, so a SQLite database must be a file:
 * `:memory:` would be a different, empty database there, and is refused.
 */
export const migrateToLatest = async ({
  config
}: MigrationTarget): Promise<void> => {
  if (
    config.client === 'better-sqlite3' &&
    config.connection.filename === ':memory:'
  ) {
    throw new Error(
      'Cannot migrate an in-memory SQLite database: the migrations run on a ' +
        'connection of their own, which would open a different database. ' +
        'Use a database file.'
    )
  }
  const { default: knex } = await import('knex')
  const instance = knex({
    ...(config as Knex.Config),
    migrations: { ...KNEX_MIGRATIONS }
  })
  try {
    await instance.migrate.latest()
  } finally {
    await instance.destroy()
  }
}

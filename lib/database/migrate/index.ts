import { type Kysely, sql } from 'kysely'

import type { DatabaseConfig } from '@/lib/config/database'
import type { DB } from '@/lib/database/kysely'
import {
  BASELINE_MIGRATION,
  type HandoverState,
  isCompleteKnexMigrationList,
  readHandoverState,
  tableExists
} from '@/lib/database/migrate/baseline'
import { createMigrator, unwrapResultSet } from '@/lib/database/migrate/runner'
import type { MigrationRegistry } from '@/lib/database/migrate/types'
import { migrations as registeredMigrations } from '@/migrations/index'

export { BASELINE_MIGRATION, LAST_KNEX_RELEASE } from './baseline'
export { MigrationRunError } from './runner'

// The one place that runs migrations or asks which ones a database has:
// `yarn migrate` (scripts/database/migrate.ts), the facade's `migrate()` and
// the production archive's restore go through here. Migrations are the
// TypeScript modules registered in migrations/index.ts, run by Kysely's
// Migrator (runner.ts) and recorded in `kysely_migration`. The first one,
// 20261014000000_baseline, is the handover from the Knex migrations
// (baseline.ts): it records the baseline on a database Knex fully migrated,
// loads it into an empty one, and refuses anything else.
//
// The facade imports this module on first use, so neither the runner nor the
// migrations are part of the app's request path.
//
// The names this module reports are migration names (`kysely_migration`'s
// rows). The production archive stores that list in its manifest and compares
// it on restore. An archive written before the handover lists the Knex
// migrations instead (`knex_migrations`' rows, file names with `.js`); when
// that list is every frozen Knex migration it reads as the baseline
// (`normalizeMigrationNames`), so such an archive keeps restoring.
//
// Callers keep two rules:
//
// - `db` is the root instance of a connection that normalises results (the
//   app's, `openScriptDatabase(config)`, `createDatabaseConnection(config)`),
//   so a migration reads rows the same way under `yarn migrate`, the facade's
//   `migrate()` and the archive's restore. The production archive's own
//   connection (`normalizeResults: false`) is never passed: its restore opens
//   a normalising one for the migrations.
// - `db` is not a transaction: each migration runs in a transaction the
//   runner opens, which Kysely cannot do on a `Transaction`.
//   `migrateToLatest` and `migrateDown` refuse one.

/** The database to migrate or inspect, as the caller already has it. */
export type MigrationTarget = {
  /**
   * Kysely on that database. Reads accept a transaction (the production
   * archive asks inside its export snapshot); `migrateToLatest` needs the
   * root instance of a normalising connection (see the rules above).
   */
  db: Kysely<DB>
  /** The configuration `db` was opened with. */
  config: DatabaseConfig
}

// Where the Migrator records which migrations ran, and its lock.
const MIGRATION_TABLE = 'kysely_migration'

/**
 * The migration runners' bookkeeping: which migrations ran, Kysely's and
 * Knex's. The production archive neither exports nor restores them; a
 * restored database keeps the history its own migrations wrote.
 */
export const MIGRATION_TABLES: readonly string[] = [
  'kysely_migration',
  'knex_migrations'
]

/**
 * The migration runners' lock tables. They hold a lock flag, not data, so the
 * production archive neither exports nor restores them.
 */
export const MIGRATION_LOCK_TABLES: readonly string[] = [
  'kysely_migration_lock',
  'knex_migrations_lock'
]

/**
 * `names` in the runner's terms: a complete list of the frozen Knex
 * migrations (what `knex_migrations` held at the handover, as an archive made
 * before it lists them) is the baseline; any other list is returned as is.
 */
export const normalizeMigrationNames = (names: readonly string[]): string[] =>
  names.length > 0 && isCompleteKnexMigrationList(names)
    ? [BASELINE_MIGRATION]
    : [...names]

type ExecutedMigration = { name: string; executedAt: string }

const readExecutedMigrations = async (
  db: Kysely<DB>
): Promise<ExecutedMigration[]> => {
  if (!(await tableExists(db, MIGRATION_TABLE))) return []
  // In the order they ran, as the Migrator orders them.
  const { rows } = await sql<{ name: unknown; timestamp: unknown }>`
    select name, timestamp from ${sql.table(MIGRATION_TABLE)}
    order by timestamp asc, name asc
  `.execute(db)
  return rows.flatMap((row) =>
    typeof row.name === 'string'
      ? [{ name: row.name, executedAt: String(row.timestamp) }]
      : []
  )
}

const readKnexMigrationNames = async (db: Kysely<DB>): Promise<string[]> => {
  if (!(await tableExists(db, 'knex_migrations'))) return []
  const { rows } = await sql<{ name: unknown }>`
    select name from knex_migrations order by id asc
  `.execute(db)
  return rows
    .map((row) => row.name)
    .filter((name): name is string => typeof name === 'string')
}

/**
 * The migrations the database has applied, in the order they ran: the names
 * `kysely_migration` holds. A database the Kysely migrations have not run on
 * yet reports its Knex migrations instead (`knex_migrations`, through
 * `normalizeMigrationNames`, so a fully Knex-migrated one reports the
 * baseline). Empty when the database has neither table.
 */
export const getAppliedMigrationNames = async ({
  db
}: MigrationTarget): Promise<string[]> => {
  const executed = await readExecutedMigrations(db)
  if (executed.length > 0) return executed.map((migration) => migration.name)
  return normalizeMigrationNames(await readKnexMigrationNames(db))
}

/** The migrations this checkout has (migrations/index.ts), sorted by name. */
export const getKnownMigrationNames = async (
  registry: MigrationRegistry = registeredMigrations
): Promise<string[]> => Object.keys(registry).sort()

export type MigrationStatus = {
  /** The migrations `kysely_migration` records, in the order they ran. */
  executed: ExecutedMigration[]
  /** Known migrations not applied yet, in the order they would run. */
  pending: string[]
  /** Recorded migrations this checkout does not have (a newer build's). */
  unknown: string[]
  /**
   * The handover: `recorded` once the baseline is in `kysely_migration`,
   * otherwise what its migration would do (see baseline.ts).
   */
  handover: { kind: 'recorded' } | HandoverState
}

/**
 * Where the database stands, read without writing anything: it creates no
 * table, so it is safe on a database the new code has never migrated
 * (`yarn migrate:status`, the startup check, the pre-check below).
 */
export const getMigrationStatus = async (
  { db }: MigrationTarget,
  registry: MigrationRegistry = registeredMigrations
): Promise<MigrationStatus> => {
  const executed = await readExecutedMigrations(db)
  const executedNames = new Set(executed.map((migration) => migration.name))
  const known = await getKnownMigrationNames(registry)
  const knownNames = new Set(known)
  return {
    executed,
    pending: known.filter((name) => !executedNames.has(name)),
    unknown: executed
      .map((migration) => migration.name)
      .filter((name) => !knownNames.has(name)),
    handover: executedNames.has(BASELINE_MIGRATION)
      ? { kind: 'recorded' }
      : await readHandoverState(db)
  }
}

const assertRootInstance = (db: Kysely<DB>) => {
  if (db.isTransaction) {
    throw new Error(
      'Cannot migrate inside a transaction: each migration runs in a ' +
        'transaction of its own. Pass the root Kysely instance.'
    )
  }
}

/**
 * Applies every pending migration, as `yarn migrate` does, and returns their
 * names in the order they ran. A database the handover refuses (see
 * baseline.ts) is refused before the Migrator creates its tables, so nothing
 * is written. Refuses a `db` that is a transaction (see the rules above).
 */
export const migrateToLatest = async (
  target: MigrationTarget,
  registry: MigrationRegistry = registeredMigrations
): Promise<string[]> => {
  assertRootInstance(target.db)
  if (registry[BASELINE_MIGRATION]) {
    const { handover } = await getMigrationStatus(target, registry)
    if (handover.kind === 'refused') throw new Error(handover.message)
  }
  return unwrapResultSet(
    await createMigrator(target.db, registry).migrateToLatest()
  )
}

/**
 * Rolls back the last migration applied, as `yarn migrate:down` does, and
 * returns its name. The baseline is never rolled back.
 */
export const migrateDown = async (
  target: MigrationTarget,
  registry: MigrationRegistry = registeredMigrations
): Promise<string> => {
  assertRootInstance(target.db)
  const { executed } = await getMigrationStatus(target, registry)
  const last = executed.at(-1)
  if (!last) {
    throw new Error('Nothing to roll back: no migration has been applied.')
  }
  if (last.name === BASELINE_MIGRATION) {
    throw new Error(
      `Nothing to roll back above the baseline: ${BASELINE_MIGRATION} is ` +
        'the last migration applied, and it cannot be rolled back.'
    )
  }
  const module = registry[last.name]
  if (!module) {
    throw new Error(
      `Cannot roll back ${last.name}: this checkout does not have it.`
    )
  }
  if (!module.down) {
    throw new Error(`Cannot roll back ${last.name}: it has no down().`)
  }
  const [rolledBack] = unwrapResultSet(
    await createMigrator(target.db, registry).migrateDown()
  )
  if (rolledBack !== last.name) {
    throw new Error(
      `Expected to roll back ${last.name}, but the migrator rolled back ` +
        `${rolledBack ?? 'nothing'}.`
    )
  }
  return rolledBack
}

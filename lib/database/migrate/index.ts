import { type Kysely, sql } from 'kysely'

import type { DB } from '@/lib/database/kysely'
import {
  BASELINE_MIGRATION,
  getMigrationBackend,
  isCompleteKnexMigrationList,
  tableExists
} from '@/lib/database/migrate/baseline'
import { createMigrator, unwrapResultSet } from '@/lib/database/migrate/runner'
import {
  type MigrationTarget,
  getMigrationStatus,
  readExecutedMigrations
} from '@/lib/database/migrate/status'
import type { MigrationRegistry } from '@/lib/database/migrate/types'
import { migrations as registeredMigrations } from '@/migrations/index'

export { BASELINE_MIGRATION, LAST_KNEX_RELEASE } from './baseline'
export { MigrationRunError } from './runner'
export {
  type ExecutedMigration,
  type MigrationStatus,
  type MigrationTarget,
  getMigrationStatus
} from './status'

// The one place that runs migrations or asks which ones a database has:
// `yarn migrate` (scripts/database/migrate.ts), the facade's `migrate()` and
// the production archive's restore go through here. Migrations are the
// TypeScript modules registered in migrations/index.ts, run by Kysely's
// Migrator (runner.ts) and recorded in `kysely_migration`. The first one,
// 20261014000000_baseline, is the handover from the Knex migrations
// (baseline.ts): it records the baseline on a database Knex fully migrated,
// loads it into an empty one, and refuses anything else.
//
// The startup check (instrumentation.ts) loads status.ts at boot to read the
// status, not this module; nothing in the app runs a migration. The facade's
// `migrate()` imports this module on first use, and only tests call it.
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

// Kysely's SQLite adapter takes no lock: its migration lock is a no-op, and the
// database's single connection serialises runs in one process only. Knex's
// lock row made a second `yarn migrate` on the same file fail with `Migration
// table is already locked`; this restores that with the Migrator's own lock
// row, so a second run cannot re-run a migration the first has just applied.
// Like Knex's, it stays held when a run is killed (`yarn migrate:unlock`).
// PostgreSQL keeps the Migrator's advisory lock, which its connection
// releases, and never touches the row.
const MIGRATION_LOCK_TABLE = 'kysely_migration_lock'
const MIGRATION_LOCK_ROW = 'migration_lock'

export const MIGRATION_LOCKED_MESSAGE =
  'kysely_migration_lock is already locked: another `yarn migrate` or ' +
  '`yarn migrate:down` is running on this database, or one was interrupted. ' +
  'If none is running, run `yarn migrate:unlock`, then run this again.'

// The lock row's state, read without writing: `missing` until the first run
// on this database creates it.
const readSqliteLock = async (
  db: Kysely<DB>
): Promise<'missing' | 'held' | 'free'> => {
  if (!(await tableExists(db, MIGRATION_LOCK_TABLE))) return 'missing'
  // oxlint-disable-next-line typescript/no-explicit-any
  const row = await (db as unknown as Kysely<any>)
    .selectFrom(MIGRATION_LOCK_TABLE)
    .select('is_locked')
    .where('id', '=', MIGRATION_LOCK_ROW)
    .executeTakeFirst()
  if (!row) return 'missing'
  return Number(row.is_locked) !== 0 ? 'held' : 'free'
}

// oxlint-disable-next-line typescript/no-explicit-any
const releaseSqliteLock = async (db: Kysely<any>) => {
  await db
    .updateTable(MIGRATION_LOCK_TABLE)
    .set({ is_locked: 0 })
    .where('id', '=', MIGRATION_LOCK_ROW)
    .execute()
}

/**
 * A thrown value as text. `String` itself throws for an object with no
 * prototype (`Object.create(null)`), which would replace the value it reports.
 */
const describeThrown = (thrown: unknown): string => {
  try {
    return String(thrown)
  } catch {
    try {
      return Object.prototype.toString.call(thrown)
    } catch {
      return '(a value that cannot be printed)'
    }
  }
}

const lockReleaseHint = (releaseError: unknown) =>
  'The migration lock (kysely_migration_lock) could not be released: ' +
  `${releaseError instanceof Error ? releaseError.message : describeThrown(releaseError)}. ` +
  'If no run is going on, run `yarn migrate:unlock`.'

const withSqliteRunLock = async <T>(
  db: Kysely<DB>,
  run: () => Promise<T>
): Promise<T> => {
  if (getMigrationBackend(db) !== 'sqlite') return run()
  // oxlint-disable-next-line typescript/no-explicit-any
  const anyDb = db as unknown as Kysely<any>
  // Read first: a run that finds the lock held is refused without writing,
  // so it cannot take SQLite's write lock while the holder is migrating
  // (which would make the holder's next write fail with `database is
  // locked`).
  const lock = await readSqliteLock(db)
  if (lock === 'held') throw new Error(MIGRATION_LOCKED_MESSAGE)
  if (lock === 'missing') {
    // The Migrator's two tables with its own DDL, in its order, so the
    // schema (and the dumps) are what it would have created; it then finds
    // them.
    await anyDb.schema
      .createTable('kysely_migration')
      .ifNotExists()
      .addColumn('name', 'varchar(255)', (col) => col.notNull().primaryKey())
      .addColumn('timestamp', 'varchar(255)', (col) => col.notNull())
      .execute()
    await anyDb.schema
      .createTable(MIGRATION_LOCK_TABLE)
      .ifNotExists()
      .addColumn('id', 'varchar(255)', (col) => col.notNull().primaryKey())
      .addColumn('is_locked', 'integer', (col) => col.notNull().defaultTo(0))
      .execute()
    await anyDb
      .insertInto(MIGRATION_LOCK_TABLE)
      .values({ id: MIGRATION_LOCK_ROW, is_locked: 0 })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute()
  }
  // One statement, so SQLite's write lock makes it atomic across processes:
  // of two runs that both read it free, one sets it and the other is refused.
  const { numUpdatedRows } = await anyDb
    .updateTable(MIGRATION_LOCK_TABLE)
    .set({ is_locked: 1 })
    .where('id', '=', MIGRATION_LOCK_ROW)
    .where('is_locked', '=', 0)
    .executeTakeFirst()
  if (Number(numUpdatedRows) !== 1) throw new Error(MIGRATION_LOCKED_MESSAGE)
  let result: T
  try {
    result = await run()
  } catch (error) {
    // The run's error is the one thrown; a failed release only adds to its
    // message, since the lock then stays held.
    try {
      await releaseSqliteLock(anyDb)
    } catch (releaseError) {
      if (!(error instanceof Error)) {
        // Something that is not an Error has no message to add to: throw
        // both, so the release failure is not lost.
        throw new AggregateError(
          [error, releaseError],
          `${describeThrown(error)}\n${lockReleaseHint(releaseError)}`,
          { cause: releaseError }
        )
      }
      error.message = `${error.message}\n${lockReleaseHint(releaseError)}`
    }
    throw error
  }
  try {
    await releaseSqliteLock(anyDb)
  } catch (releaseError) {
    throw new Error(
      `The migrations ran, but the lock stays held. ${lockReleaseHint(releaseError)}`,
      { cause: releaseError }
    )
  }
  return result
}

/**
 * Whether a run holds the SQLite migration lock, read without writing, as
 * `yarn migrate:status` reports it: `held` (so `yarn migrate` would be
 * refused until it is released) or `free`. On PostgreSQL the lock is the
 * Migrator's advisory lock (`advisory`), and nothing is read.
 */
export const getMigrationLockState = async ({
  db
}: MigrationTarget): Promise<'held' | 'free' | 'advisory'> => {
  if (getMigrationBackend(db) !== 'sqlite') return 'advisory'
  return (await readSqliteLock(db)) === 'held' ? 'held' : 'free'
}

/**
 * Releases the SQLite migration lock a killed `yarn migrate` left held, as
 * `yarn migrate:unlock` does: `released` when it was held, `not-held`
 * otherwise. On PostgreSQL the lock is the Migrator's advisory lock, which
 * ends with the connection holding it, so there is nothing to release
 * (`advisory`): it only runs `select 1`, so a configuration that does not
 * reach the database fails here instead of reporting nothing to release.
 */
export const unlockMigrations = async ({
  db
}: MigrationTarget): Promise<'released' | 'not-held' | 'advisory'> => {
  if (getMigrationBackend(db) !== 'sqlite') {
    await sql`select 1`.execute(db)
    return 'advisory'
  }
  if (!(await tableExists(db, MIGRATION_LOCK_TABLE))) return 'not-held'
  // oxlint-disable-next-line typescript/no-explicit-any
  const { numUpdatedRows } = await (db as unknown as Kysely<any>)
    .updateTable(MIGRATION_LOCK_TABLE)
    .set({ is_locked: 0 })
    .where('id', '=', MIGRATION_LOCK_ROW)
    .where('is_locked', '<>', 0)
    .executeTakeFirst()
  return Number(numUpdatedRows) > 0 ? 'released' : 'not-held'
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
    const { handover } = await getMigrationStatus(target, Object.keys(registry))
    if (handover.kind === 'refused') throw new Error(handover.message)
  }
  return withSqliteRunLock(target.db, async () =>
    unwrapResultSet(await createMigrator(target.db, registry).migrateToLatest())
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
  const { executed } = await getMigrationStatus(target, Object.keys(registry))
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
  const [rolledBack] = await withSqliteRunLock(target.db, async () =>
    unwrapResultSet(await createMigrator(target.db, registry).migrateDown())
  )
  if (rolledBack !== last.name) {
    throw new Error(
      `Expected to roll back ${last.name}, but the migrator rolled back ` +
        `${rolledBack ?? 'nothing'}.`
    )
  }
  return rolledBack
}

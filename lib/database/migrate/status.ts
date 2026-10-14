import { type Kysely, sql } from 'kysely'

import type { DatabaseConfig } from '@/lib/config/database'
import type { DB } from '@/lib/database/kysely'
import {
  BASELINE_MIGRATION,
  type HandoverState,
  readHandoverState,
  tableExists
} from '@/lib/database/migrate/baseline'
import { MIGRATION_NAMES } from '@/migrations/names'

// Where a database stands, read without writing anything. Kept apart from
// lib/database/migrate (index.ts) so the startup check (instrumentation.ts →
// startupCheck.ts) loads only this at boot: it imports neither the runner
// (Kysely's Migrator) nor any migration module, and compares the database
// against the registered migrations' names (migrations/names.ts) alone.

/** The database to migrate or inspect, as the caller already has it. */
export type MigrationTarget = {
  /**
   * Kysely on that database. Reads accept a transaction (the production
   * archive asks inside its export snapshot); `migrateToLatest` needs the
   * root instance of a normalising connection (see lib/database/migrate).
   */
  db: Kysely<DB>
  /** The configuration `db` was opened with. */
  config: DatabaseConfig
}

// Where the Migrator records which migrations ran.
export const MIGRATION_TABLE = 'kysely_migration'

export type ExecutedMigration = { name: string; executedAt: string }

export const readExecutedMigrations = async (
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
 * (`yarn migrate:status`, the startup check, the pre-check in
 * `migrateToLatest`). `knownNames` are the migrations this checkout has: the
 * registered ones (migrations/names.ts) unless a caller runs a registry of
 * its own.
 */
export const getMigrationStatus = async (
  { db }: MigrationTarget,
  knownNames: readonly string[] = MIGRATION_NAMES
): Promise<MigrationStatus> => {
  const executed = await readExecutedMigrations(db)
  const executedNames = new Set(executed.map((migration) => migration.name))
  const known = [...knownNames].sort()
  const knownSet = new Set(known)
  return {
    executed,
    pending: known.filter((name) => !executedNames.has(name)),
    unknown: executed
      .map((migration) => migration.name)
      .filter((name) => !knownSet.has(name)),
    handover: executedNames.has(BASELINE_MIGRATION)
      ? { kind: 'recorded' }
      : await readHandoverState(db)
  }
}

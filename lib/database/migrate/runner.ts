import type { Kysely } from 'kysely'
import {
  type Migration,
  type MigrationResult,
  type MigrationResultSet,
  Migrator
} from 'kysely/migration'

import { type DB, inTransaction } from '@/lib/database/kysely'
import type {
  MigrationModule,
  MigrationRegistry
} from '@/lib/database/migrate/types'

// Kysely's Migrator, run the way this project runs migrations:
//
// - Each migration runs in a transaction of its own, which this provider
//   opens (with `inTransaction`, so a root-instance query inside it is refused
//   as everywhere else). Kysely's own handling would differ by backend: no
//   transaction at all on SQLite (its adapter does not claim transactional
//   DDL), and the whole pending batch in one transaction on PostgreSQL. A
//   module exporting `config = { transaction: false }` runs with none.
// - A failed migration rolls back alone: the ones before it stay applied and
//   recorded, and the run stops there.
// - The Migrator records a migration in `kysely_migration` after its
//   transaction commits, so a crash in between runs it again next time: keep
//   `up` safe to re-run.
// - Unordered migrations are allowed: one merged with an older name than a
//   migration already applied still runs, as Knex ran it, instead of the
//   Migrator's "corrupted migrations" error.
// - The Migrator's lock serialises concurrent runs on PostgreSQL: a session
//   advisory lock held on the migrating connection. On SQLite it is a no-op,
//   so lib/database/migrate takes the lock row in `kysely_migration_lock`
//   around the run instead, and a second process is refused while it is held.

const wrapStep =
  (
    module: MigrationModule,
    step: (module: MigrationModule) => MigrationModule['up'] | undefined
  ) =>
  // oxlint-disable-next-line typescript/no-explicit-any
  async (db: Kysely<any>) => {
    const run = step(module)
    if (!run) return
    if (module.config?.transaction === false) {
      await run(db)
      return
    }
    await inTransaction(db as Kysely<DB>, (trx) =>
      // oxlint-disable-next-line typescript/no-explicit-any
      run(trx as unknown as Kysely<any>)
    )
  }

const toMigration = (module: MigrationModule): Migration => ({
  up: wrapStep(module, (it) => it.up),
  ...(module.down ? { down: wrapStep(module, (it) => it.down) } : {})
})

/** A Kysely Migrator over `registry` on `db` (the root instance). */
export const createMigrator = (
  db: Kysely<DB>,
  registry: MigrationRegistry
): Migrator =>
  new Migrator({
    // oxlint-disable-next-line typescript/no-explicit-any
    db: db as unknown as Kysely<any>,
    provider: {
      getMigrations: async () =>
        Object.fromEntries(
          Object.entries(registry).map(([name, module]) => [
            name,
            toMigration(module)
          ])
        )
    },
    // The provider opens each migration's transaction.
    disableTransactions: true,
    allowUnorderedMigrations: true
  })

/**
 * A thrown value as text. `String` itself throws for an object with no
 * prototype (`Object.create(null)`), which would replace the value it reports.
 */
export const describeThrown = (thrown: unknown): string => {
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

/** Thrown when a run fails; `results` says what ran before the failure. */
export class MigrationRunError extends Error {
  readonly results: readonly MigrationResult[]

  constructor(error: unknown, results: readonly MigrationResult[]) {
    const failed = results.find((result) => result.status === 'Error')
    const reason =
      error instanceof Error ? error.message : describeThrown(error)
    super(
      failed
        ? `Migration ${failed.migrationName} failed: ${reason}`
        : `Migrations failed: ${reason}`,
      { cause: error }
    )
    this.name = 'MigrationRunError'
    this.results = results
  }
}

/**
 * The migrations a run applied (or rolled back), in order. Throws
 * `MigrationRunError` when the run failed; what ran before the failure stays.
 */
export const unwrapResultSet = ({
  error,
  results = []
}: MigrationResultSet): string[] => {
  if (error !== undefined) throw new MigrationRunError(error, results)
  return results
    .filter((result) => result.status === 'Success')
    .map((result) => result.migrationName)
}

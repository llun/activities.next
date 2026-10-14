import type { Kysely } from 'kysely'

/**
 * A migration module (`migrations/<yyyymmddhhmmss>_<name>.ts`), as registered
 * in migrations/index.ts. Migrations take `Kysely<any>`: they create and
 * change tables the generated `DB` types do not describe yet.
 */
export type MigrationModule = {
  // oxlint-disable-next-line typescript/no-explicit-any
  up: (db: Kysely<any>) => Promise<void>
  // oxlint-disable-next-line typescript/no-explicit-any
  down?: (db: Kysely<any>) => Promise<void>
  /**
   * `transaction: false` runs the migration with no transaction around it
   * (for statements PostgreSQL refuses inside one, such as
   * `create index concurrently`). Every other migration runs in a transaction
   * of its own.
   */
  config?: { transaction?: boolean }
}

/** The migrations, by name; the name orders them. */
export type MigrationRegistry = Readonly<Record<string, MigrationModule>>

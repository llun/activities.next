// The name of every migration registered in migrations/index.ts (the file name
// without `.ts`). A plain list, without the modules, so what only needs the
// names (the startup check, through lib/database/migrate/status.ts) does not
// load the migrations or Kysely's Migrator. migrations/index.ts must register
// exactly these: `yarn typecheck` fails when the two disagree.
export const MIGRATION_NAMES = ['20261014000000_baseline'] as const

export type MigrationName = (typeof MIGRATION_NAMES)[number]

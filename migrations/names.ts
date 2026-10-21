// The name of every migration registered in migrations/index.ts (the file name
// without `.ts`). A plain list, without the modules, so what only needs the
// names (the startup check, through lib/database/migrate/status.ts) does not
// load the migrations or Kysely's Migrator. migrations/index.ts must register
// exactly these: `yarn typecheck` fails when the two disagree.
export const MIGRATION_NAMES = [
  '20261014000000_baseline',
  '20261015000000_add_fitness_file_route_data',
  '20261018170047_add_domains',
  '20261018204230_add_accounts_sign_up_domain',
  '20261020232218_add_domains_identity',
  '20261021120000_add_domain_scopes'
] as const

export type MigrationName = (typeof MIGRATION_NAMES)[number]

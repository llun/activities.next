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
  '20261020194752_add_idempotency_keys_content_hash',
  '20261020232218_add_domains_identity',
  '20261021052511_add_idempotency_keys_state_changed_at',
  '20261021072844_add_domain_scopes',
  '20261024100037_add_bulk_imports',
  '20261024100100_add_account_archives',
  '20261024131756_add_actor_migrations',
  '20261024160234_add_media_sort_at'
] as const

export type MigrationName = (typeof MIGRATION_NAMES)[number]

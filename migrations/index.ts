import type {
  MigrationModule,
  MigrationRegistry
} from '@/lib/database/migrate/types'

import * as baseline from './20261014000000_baseline'
import * as addFitnessFileRouteData from './20261015000000_add_fitness_file_route_data'
import * as addDomains from './20261018170047_add_domains'
import * as addAccountsSignUpDomain from './20261018204230_add_accounts_sign_up_domain'
import * as addIdempotencyKeysContentHash from './20261020194752_add_idempotency_keys_content_hash'
import * as addDomainsIdentity from './20261020232218_add_domains_identity'
import * as addIdempotencyKeysStateChangedAt from './20261021052511_add_idempotency_keys_state_changed_at'
import * as addDomainScopes from './20261021072844_add_domain_scopes'
import * as addBulkImports from './20261024100037_add_bulk_imports'
import * as addAccountArchives from './20261024100100_add_account_archives'
import * as addMediaSortAt from './20261024160234_add_media_sort_at'
import type { MigrationName } from './names'

// Every migration, registered by name (the file name without `.ts`). `yarn
// migrate` runs them in name order through Kysely's Migrator
// (lib/database/migrate/runner.ts). A static list rather than a directory
// read, so the migrations are type-checked and bundled like any other module.
// `yarn migrate:make <name>` writes a new file; add it here and its name to
// migrations/names.ts (the `satisfies` below fails the typecheck until both
// list the same names).
export const migrations: MigrationRegistry = {
  '20261014000000_baseline': baseline,
  '20261015000000_add_fitness_file_route_data': addFitnessFileRouteData,
  '20261018170047_add_domains': addDomains,
  '20261018204230_add_accounts_sign_up_domain': addAccountsSignUpDomain,
  '20261020194752_add_idempotency_keys_content_hash':
    addIdempotencyKeysContentHash,
  '20261020232218_add_domains_identity': addDomainsIdentity,
  '20261021052511_add_idempotency_keys_state_changed_at':
    addIdempotencyKeysStateChangedAt,
  '20261021072844_add_domain_scopes': addDomainScopes,
  '20261024100037_add_bulk_imports': addBulkImports,
  '20261024100100_add_account_archives': addAccountArchives,
  '20261024160234_add_media_sort_at': addMediaSortAt
} satisfies Record<MigrationName, MigrationModule>

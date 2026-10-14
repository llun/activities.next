import type { MigrationRegistry } from '@/lib/database/migrate/types'

import * as baseline from './20261014000000_baseline'

// Every migration, registered by name (the file name without `.ts`). `yarn
// migrate` runs them in name order through Kysely's Migrator
// (lib/database/migrate/runner.ts). A static list rather than a directory
// read, so the migrations are type-checked and bundled like any other module.
// `yarn migrate:make <name>` writes a new file; add it here.
export const migrations: MigrationRegistry = {
  '20261014000000_baseline': baseline
}

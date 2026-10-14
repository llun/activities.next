import type { Kysely } from 'kysely'

import {
  applyBaseline,
  refuseBaselineRollback
} from '@/lib/database/migrate/baseline'

// The first Kysely migration: the handover from the Knex migrations
// (migrations/legacy/). A database Knex fully migrated has the baseline
// recorded without any DDL; an empty one gets the frozen baseline schema
// (migrations/baseline/); anything else is refused. See
// lib/database/migrate/baseline.ts.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = (db: Kysely<any>) => applyBaseline(db)

export const down = () => refuseBaselineRollback()

#!/usr/bin/env -S node scripts/run.cjs
/**
 * Fills `medias.sortAt` for rows that a build older than the
 * `add_media_sort_at` migration inserted while it was rolling out (the column
 * is only set on insert, so nothing else fills them). Until then those photos
 * are left out of the date sorts and the month facets.
 *
 * It re-runs the migration's own backfill, which only touches rows whose
 * `sortAt` is NULL and is safe to repeat. Exit `0` means none is left.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/backfillMediaSortAt.ts
 */
import { loadEnvConfig } from '@next/env'

import { getKysely } from '@/lib/database'
import { up } from '@/migrations/20261024160234_add_media_sort_at'

loadEnvConfig(process.cwd(), process.env.NODE_ENV === 'development')

const db = getKysely()
up(db)
  .then(async () => {
    const left = await db
      .selectFrom('medias')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('sortAt', 'is', null)
      .executeTakeFirstOrThrow()
    console.log(`Media rows still without sortAt: ${Number(left.count)}`)
    process.exit(Number(left.count) === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })

#!/usr/bin/env -S node scripts/run.cjs
/**
 * Rewrites notification ids that are not time-ordered (random UUIDv4s) into
 * UUIDv7s minted from each row's `createdAt`, and repoints the `notifications`
 * read marker at the new id — the same rewrite, through the same code, as
 * `migrations/20261009163215_time_ordered_notification_ids.js`.
 *
 * WHY THIS EXISTS. `yarn migrate` runs from a checkout against the live
 * database while the PREVIOUS image keeps serving traffic, and that image still
 * mints v4 notification ids. Every notification it writes after the migration
 * passes it — right through to the end of the rollout — keeps a v4 id, and
 * `yarn migrate` is a no-op once knex has recorded the migration. Those rows
 * never age out: a v4 id almost always sorts above every v7 id, so a client
 * that orders by id pins them to the top of the list and may set its read
 * marker to one, making newer notifications look read. Run this once the new
 * build is fully rolled out.
 *
 * Safe to run repeatedly against a live production database: rows that are
 * already v7 are never touched, so a second run over a clean database is a
 * no-op, and each chunk commits in its own short transaction.
 *
 * EXIT CODE. 0 only when no notification is left with a non-time-ordered id. 1
 * otherwise, including in `--dry-run`, where nothing was written.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/rewriteNotificationIds.ts \
 *     [--dry-run [true|false]] [--batch-size 500]
 *
 * Options:
 *   --dry-run     Report how many ids would be rewritten without writing
 *   --batch-size  Rows read per pass (default 500)
 */
import { loadEnvConfig } from '@next/env'
import knex from 'knex'

import { getDatabaseConfig } from '@/lib/config/database'
import { rewriteNotificationIds } from '@/lib/database/sql/notificationIdRewrite.js'

import { printDatabaseBanner } from '../fitness/describeConnection'
import { parseArgs } from './backfillPublicIds'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const USAGE = `Usage: NODE_ENV=production scripts/maintenance/rewriteNotificationIds.ts \\
  [--dry-run [true|false]] [--batch-size 500]`

// Runs the rewrite (or, with dryRun, only counts) and re-counts afterwards, so
// the exit code reflects what is left rather than what this run saw.
export const runRewrite = async (
  database: knex.Knex,
  { dryRun, batchSize }: { dryRun: boolean; batchSize: number }
): Promise<number> => {
  const log = (message: string) => console.log(message)
  const result = await rewriteNotificationIds(database, {
    batchSize,
    dryRun,
    log
  })
  const remaining = dryRun
    ? result.pending
    : (await rewriteNotificationIds(database, { batchSize, dryRun: true }))
        .pending

  console.log('\nSummary')
  console.log(
    `  notifications: ${result.scanned} scanned, ${result.rewritten} rewritten, ` +
      `${result.markers} marker(s) repointed, ${remaining} still not time-ordered`
  )

  if (remaining === 0) {
    console.log('\nEvery notification id is time-ordered.')
    return 0
  }
  if (dryRun) {
    console.log(
      `\nDry run: ${remaining} id(s) would be rewritten. Re-run without --dry-run.`
    )
    return 1
  }
  console.log(
    `\n${remaining} id(s) are still not time-ordered.\n` +
      'If a pod of the previous build is still serving, finish the rollout and run this again.'
  )
  return 1
}

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  let input: ReturnType<typeof parseArgs>
  try {
    input = parseArgs(args)
  } catch (error) {
    console.error((error as Error).message)
    console.error(USAGE)
    return 1
  }

  printDatabaseBanner()
  if (input.dryRun) {
    console.log('(dry-run mode - no rows will be written)')
  }

  const databaseConfig = getDatabaseConfig()
  if (!databaseConfig) {
    console.error('Error: Database is not configured')
    return 1
  }

  const database = knex(databaseConfig.database)
  try {
    return await runRewrite(database, input)
  } finally {
    await database.destroy()
  }
}

if (require.main === module) {
  main()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

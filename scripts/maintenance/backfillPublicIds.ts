#!/usr/bin/env -S node scripts/run.cjs
/**
 * Backfills `publicId` for `statuses` and `actors` rows that still have NULL,
 * minting a UUIDv7 from each row's `createdAt` so ids stay time-ordered exactly
 * as `migrations/20260808000000_add_public_ids.js` produced them.
 *
 * WHY THIS EXISTS. The migration cannot finish the job on its own. `yarn
 * migrate` runs from a checkout against the live database while the PREVIOUS
 * image keeps serving traffic (the runtime image ships no Knex CLI — see
 * docs/postgresql-setup.md), and that image predates publicId, so every row it
 * inserts leaves publicId NULL. The new build cannot go first either: its
 * INSERTs write a publicId value and need the column. The residue therefore
 * keeps growing from the moment the migration's sweep converges until the
 * rollout completes, and nothing fills it in afterwards — publicId is only ever
 * minted on insert, there is no lazy mint, and `yarn migrate` is a no-op once
 * knex has recorded the migration. Run this AFTER the new build is fully rolled
 * out and before anything starts emitting publicIds.
 *
 * Safe to run repeatedly against a live production database: every UPDATE keeps
 * the `publicId IS NULL` guard, so a value written concurrently by the app is
 * never clobbered, and a second run over a clean database is a no-op.
 *
 * Rows with a NULL `id` cannot be addressed at all: the bulk UPDATE matches on
 * `id IN (...)`, and SQL never matches NULL with IN. (Addressing them one row at
 * a time would be worse than useless — knex compiles `.where('id', null)` to
 * `id IS NULL`, which matches every null-id row at once and would write one
 * publicId to all of them, which the unique index rejects.) `actors.id` is
 * nullable in both schema dumps, so such rows can exist; they are skipped and
 * reported instead.
 *
 * EXIT CODE. 0 only when no NULL publicId remains anywhere — that is the deploy
 * gate for the follow-up "emit publicIds" change. 1 when any row still has one,
 * including in `--dry-run`, where nothing was written so the gate is unmet by
 * definition.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/backfillPublicIds.ts \
 *     [--dry-run [true|false]] [--batch-size 500]
 *
 * Options:
 *   --dry-run     Report what would be backfilled without writing anything
 *   --batch-size  Rows per pass (default 500)
 */
import { loadEnvConfig } from '@next/env'
import knex from 'knex'
import { z } from 'zod'

import { getDatabaseConfig } from '@/lib/config/database'
import { generatePublicId } from '@/lib/utils/publicId'

import { printDatabaseBanner } from '../fitness/describeConnection'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const TABLE_NAMES = ['statuses', 'actors'] as const
type TableName = (typeof TABLE_NAMES)[number]

const DEFAULT_BATCH_SIZE = 500

// Upper bound on passes per table, so an UPDATE that silently takes no effect
// can never spin forever. The no-progress check below normally stops first;
// this only backstops a pathological case where every pass fills something but
// the table never drains.
const MAX_PASSES = 10000

const SQLITE_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/

// SQLite hands back `createdAt` as a naive UTC string ('2024-03-04 05:06:07')
// which `new Date` would read as LOCAL time; PostgreSQL hands back a Date.
export const toDate = (value: unknown): Date => {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const normalized = SQLITE_UTC_TIMESTAMP_PATTERN.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed
    return new Date(normalized)
  }
  return new Date(value as number)
}

// Mirrors mintPublicId() in migrations/20260808000000_add_public_ids.js so a row
// repaired here is indistinguishable from one the migration filled. That
// migration is plain ESM JavaScript executed by the knex CLI, which resolves no
// `@/` aliases and compiles no TypeScript, so it cannot import this — the two
// copies are kept in step by hand and pinned by backfillPublicIds.test.ts.
export const mintPublicId = (createdAt: unknown): string =>
  generatePublicId(toDate(createdAt).getTime())

const CliArgs = z.object({
  dryRun: z.boolean().default(false),
  batchSize: z.number().int().positive().default(DEFAULT_BATCH_SIZE)
})

const USAGE = `Usage: NODE_ENV=production scripts/maintenance/backfillPublicIds.ts \\
  [--dry-run [true|false]] [--batch-size 500]`

const parseBooleanFlagValue = (value?: string) => {
  if (value === undefined || value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid boolean value: ${value}. Use true or false.`)
}

export const parseArgs = (args: string[]) => {
  let dryRun = false
  let batchSize = DEFAULT_BATCH_SIZE

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)

    if (rawKey === 'dry-run') {
      if (inlineValue !== undefined) {
        dryRun = parseBooleanFlagValue(inlineValue)
        continue
      }
      const nextValue = args[index + 1]
      if (nextValue && !nextValue.startsWith('--')) {
        dryRun = parseBooleanFlagValue(nextValue)
        index += 1
        continue
      }
      dryRun = true
      continue
    }

    if (rawKey === 'batch-size') {
      const nextValue = inlineValue ?? args[index + 1]
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error(`Missing value for --${rawKey}`)
      }
      if (inlineValue === undefined) index += 1
      const parsed = Number(nextValue)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(
          `Invalid batch size: ${nextValue}. Use a positive integer.`
        )
      }
      batchSize = parsed
      continue
    }

    throw new Error(`Unknown argument: --${rawKey}`)
  }

  return CliArgs.parse({ dryRun, batchSize })
}

// Rows folded into a single bulk UPDATE, matching the migration's constant of
// the same name. Each row contributes three bind parameters (the CASE match,
// the CASE value, and the id in the IN list), so 200 rows is 600 parameters —
// under the 999-parameter floor of the most conservatively built SQLite, and
// nowhere near PostgreSQL's 65535.
const UPDATE_CHUNK_SIZE = 200

interface PublicIdUpdate {
  id: string
  publicId: string
}

// One UPDATE per chunk, awaited one chunk at a time.
//
// This used to be a per-row UPDATE fanned out with Promise.all over the whole
// --batch-size (500 by default). The pool this script runs on is the APP's
// (`getDatabaseConfig()`), which caps at ACTIVITIES_DATABASE_PG_POOL_MAX — 5 in
// production and 1 if unset — so the other 495 queries sat in tarn's acquire
// queue and the whole batch had to drain inside a single 60s
// acquireConnectionTimeout. That is the same failure that killed the migration
// mid-backfill ("Timeout acquiring a connection. The pool is probably full."),
// only on a tighter pool; see the matching bulkUpdatePublicIds() in
// migrations/20260808000000_add_public_ids.js.
//
// Awaiting sequentially means the backfill holds exactly ONE pooled connection
// at any moment: it cannot starve its own pool, and it leaves the rest of the
// connection budget to the app serving traffic — which matters here precisely
// because this script is meant to run against a live production database.
const bulkUpdatePublicIds = async (
  database: knex.Knex,
  tableName: TableName,
  updates: PublicIdUpdate[]
) => {
  let updated = 0

  for (let offset = 0; offset < updates.length; offset += UPDATE_CHUNK_SIZE) {
    const chunk = updates.slice(offset, offset + UPDATE_CHUNK_SIZE)

    // `else ??` is unreachable — the IN list restricts the statement to exactly
    // the ids the CASE enumerates — but it keeps the expression total, so a row
    // can never be blanked, and it gives PostgreSQL a typed branch to resolve
    // the otherwise-unknown parameters against.
    const caseSql = `case ?? ${chunk.map(() => 'when ? then ?').join(' ')} else ?? end`
    const caseBindings = [
      'id',
      ...chunk.flatMap(({ id, publicId }) => [id, publicId]),
      'publicId'
    ]

    // Built through the query builder rather than database.raw so the return
    // value is knex's normalised affected-row count on every dialect (a raw
    // UPDATE hands back the driver's own result shape instead).
    const affected = await database(tableName)
      .whereIn(
        'id',
        chunk.map(({ id }) => id)
      )
      // The same guard the migration uses: a publicId written by the app
      // between the SELECT and this UPDATE wins, and re-running the script
      // never rewrites a row that already has one.
      .whereNull('publicId')
      .update({ publicId: database.raw(caseSql, caseBindings) })

    updated += Number(affected ?? 0)
  }

  return updated
}

interface TableReport {
  table: TableName
  backfilled: number
  unaddressable: number
  remaining: number
  stopReason: string | null
}

// Rows still missing a publicId, split by whether an id-based UPDATE can
// address them at all. `addressable: false` counts the NULL-id rows described
// above — `id IN (...)` never matches NULL.
const countMissingPublicIds = async (
  database: knex.Knex,
  tableName: TableName,
  addressable: boolean
) => {
  const query = database(tableName).whereNull('publicId')
  const result = await (
    addressable ? query.whereNotNull('id') : query.whereNull('id')
  )
    .count('* as cnt')
    .first()
  return Number(result?.cnt ?? 0)
}

export const backfillTable = async (
  database: knex.Knex,
  tableName: TableName,
  { dryRun, batchSize }: { dryRun: boolean; batchSize: number }
): Promise<TableReport> => {
  const pending = await countMissingPublicIds(database, tableName, true)
  console.log(`\n${tableName}: ${pending} row(s) with a NULL publicId to fill`)

  let backfilled = 0
  let stopReason: string | null = null

  if (dryRun) {
    console.log(`  ${tableName}: dry run, nothing written`)
  } else {
    let pass = 0
    while (pass < MAX_PASSES) {
      pass += 1

      // Deliberately unordered and predicated on the condition being repaired
      // rather than on a cursor: rows the app inserts while this runs land in
      // arbitrary id order, and re-selecting on `publicId IS NULL` converges on
      // them regardless. An ORDER BY would force a sort and defeat the index
      // scan that keeps this cheap on a large table.
      const rows = await database(tableName)
        .select('id', 'createdAt')
        .whereNull('publicId')
        .whereNotNull('id')
        .limit(batchSize)
      if (rows.length === 0) break

      const filled = await bulkUpdatePublicIds(
        database,
        tableName,
        rows.map((row: { id: string; createdAt: unknown }) => ({
          id: row.id,
          publicId: mintPublicId(row.createdAt)
        }))
      )
      backfilled += filled
      console.log(
        `  ${tableName}: pass ${pass} - ${filled}/${rows.length} filled (${backfilled} total)`
      )

      // Nothing here ever clears publicId, so a pass that selects NULL rows and
      // changes none of them means the UPDATE is not taking effect. Stop
      // instead of re-selecting the same rows forever.
      if (filled === 0) {
        stopReason = `made no progress on ${rows.length} row(s)`
        break
      }
    }

    if (pass >= MAX_PASSES && stopReason === null) {
      stopReason = `hit the ${MAX_PASSES}-pass safety bound`
    }
    if (stopReason) {
      console.log(`  ${tableName}: stopped - ${stopReason}`)
    }
  }

  const unaddressable = await countMissingPublicIds(database, tableName, false)
  const remaining = await countMissingPublicIds(database, tableName, true)

  return { table: tableName, backfilled, unaddressable, remaining, stopReason }
}

async function backfillPublicIds(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  let input: z.infer<typeof CliArgs>
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
    const reports: TableReport[] = []
    for (const tableName of TABLE_NAMES) {
      reports.push(await backfillTable(database, tableName, input))
    }

    const totals = reports.reduce(
      (sum, report) => ({
        backfilled: sum.backfilled + report.backfilled,
        unaddressable: sum.unaddressable + report.unaddressable,
        remaining: sum.remaining + report.remaining
      }),
      { backfilled: 0, unaddressable: 0, remaining: 0 }
    )

    console.log('\nSummary')
    for (const report of reports) {
      console.log(
        `  ${report.table}: ${report.backfilled} backfilled, ` +
          `${report.unaddressable} skipped (NULL id), ` +
          `${report.remaining} still NULL`
      )
    }
    console.log(
      `  total: ${totals.backfilled} backfilled, ` +
        `${totals.unaddressable} skipped (NULL id), ` +
        `${totals.remaining} still NULL`
    )

    if (totals.unaddressable > 0) {
      console.log(
        `\n${totals.unaddressable} row(s) have a NULL id and cannot be addressed by an id-based UPDATE.\n` +
          'Repair their id first — until then they can never carry a publicId.'
      )
    }

    const stopped = reports.filter((report) => report.stopReason)
    for (const report of stopped) {
      console.log(
        `\n${report.table}: the backfill ${report.stopReason} — its UPDATEs are not taking effect.\n` +
          'Investigate before re-running (a trigger, a permission, or a row vanishing mid-pass).'
      )
    }

    const outstanding = totals.remaining + totals.unaddressable
    if (outstanding === 0) {
      console.log(
        '\nNo NULL publicId rows remain. The publicId deploy gate is satisfied.'
      )
      return 0
    }

    if (input.dryRun) {
      console.log(
        `\nDry run: ${totals.remaining} row(s) would be backfilled. Re-run without --dry-run.`
      )
      return 1
    }

    console.log(
      `\n${outstanding} row(s) still have a NULL publicId — the deploy gate is NOT satisfied.\n` +
        'If any pre-publicId pod is still serving, finish the rollout and run this again.'
    )
    return 1
  } finally {
    await database.destroy()
  }
}

if (require.main === module) {
  backfillPublicIds()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

export { backfillPublicIds }

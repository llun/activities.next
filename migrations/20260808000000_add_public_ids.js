import { v7 } from 'uuid'

export const config = { transaction: false }

const SQLITE_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/

const toDate = (value) => {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const normalized = SQLITE_UTC_TIMESTAMP_PATTERN.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed
    return new Date(normalized)
  }
  return new Date(value)
}

const mintPublicId = (createdAt) => {
  const time = toDate(createdAt).getTime()
  const msecs = Number.isFinite(time) && time >= 0 ? time : 0
  return v7({ msecs })
}

const hasIndex = async (knex, tableName, indexName) => {
  const client = knex.client.config.client

  if (client === 'better-sqlite3' || client === 'sqlite3') {
    const indexes = await knex.raw(`PRAGMA index_list('${tableName}')`)
    return indexes.some(({ name }) => name === indexName)
  }

  if (client === 'pg' || client === 'postgres' || client === 'postgresql') {
    const result = await knex
      .select('indexname')
      .from('pg_indexes')
      .where({ tablename: tableName, indexname: indexName })
      .first()
    return Boolean(result)
  }

  if (client === 'mysql' || client === 'mysql2') {
    const [rows] = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [
      tableName,
      indexName
    ])
    return rows.length > 0
  }

  return false
}

// The column add and the unique index/constraint add are checked and applied
// as two INDEPENDENTLY idempotent steps. A single alterTable() doing both
// compiles to two separate, non-atomic SQL statements on every dialect here —
// with config.transaction = false below (required for the batched backfill
// to commit progressively), a process interruption between the two
// statements would otherwise leave the column present but the index missing,
// and a hasColumn-only idempotency check would then silently skip creating
// the index forever on every subsequent run.
const addPublicIdColumn = async (knex, tableName, indexName) => {
  const hasColumn = await knex.schema.hasColumn(tableName, 'publicId')
  if (!hasColumn) {
    console.log(`Adding ${tableName}.publicId...`)
    await knex.schema.alterTable(tableName, (table) => {
      table.string('publicId', 36).nullable()
    })
  } else {
    console.log(`${tableName}.publicId already exists, skipping column add`)
  }

  if (!(await hasIndex(knex, tableName, indexName))) {
    console.log(`Adding ${indexName}...`)
    await knex.schema.alterTable(tableName, (table) => {
      table.unique(['publicId'], { indexName })
    })
  } else {
    console.log(`${indexName} already exists, skipping index add`)
  }
}

const BATCH_SIZE = 500

// Rows folded into a single bulk UPDATE. Each row contributes three bind
// parameters (the CASE match, the CASE value, and the id in the IN list), so
// 200 rows is 600 parameters — under the 999-parameter floor of the most
// conservatively built SQLite, and nowhere near PostgreSQL's 65535.
const UPDATE_CHUNK_SIZE = 200

// One UPDATE per chunk, awaited one chunk at a time.
//
// This used to be a per-row UPDATE fanned out with Promise.all over the whole
// BATCH_SIZE. knex's pool defaults to 10 connections, so 490 of those 500
// queries sat in tarn's acquire queue and the entire batch had to drain within
// a single 60s acquireConnectionTimeout. On a large table against a remote
// database that is also serving traffic, the queue eventually outlives that
// timeout and the migration dies mid-backfill with "Timeout acquiring a
// connection. The pool is probably full."
//
// Awaiting sequentially means the backfill holds exactly ONE pooled connection
// at any moment: it cannot starve its own pool, and it leaves the database's
// connection budget to the app running alongside it. It is also far faster —
// 174k rows go from 174k round trips to ~900.
const bulkUpdatePublicIds = async (knex, tableName, updates) => {
  let updated = 0

  for (let offset = 0; offset < updates.length; offset += UPDATE_CHUNK_SIZE) {
    const chunk = updates.slice(offset, offset + UPDATE_CHUNK_SIZE)

    // `else ??` is unreachable — the IN list below restricts the statement to
    // exactly the ids the CASE enumerates — but it keeps the expression total,
    // so a row can never be blanked, and it gives PostgreSQL a typed branch to
    // resolve the otherwise-unknown parameters against.
    const caseSql = `case ?? ${chunk.map(() => 'when ? then ?').join(' ')} else ?? end`
    const caseBindings = [
      'id',
      ...chunk.flatMap(({ id, publicId }) => [id, publicId]),
      'publicId'
    ]

    // Built through the query builder rather than knex.raw so the return value
    // is knex's normalised affected-row count on every dialect (a raw UPDATE
    // hands back the driver's own result shape instead).
    const affected = await knex(tableName)
      .whereIn(
        'id',
        chunk.map(({ id }) => id)
      )
      .whereNull('publicId')
      .update({ publicId: knex.raw(caseSql, caseBindings) })

    updated += Number(affected ?? 0)
  }

  return updated
}

// Upper bound on sweepMissingPublicIds() passes, so a silently ineffective
// UPDATE can never spin forever. At BATCH_SIZE rows per pass this covers far
// more stragglers than an online migration can realistically accumulate; if it
// ever trips, the sweep stops and the completeness check below fails the
// migration so `yarn migrate` resumes it.
const MAX_SWEEP_PASSES = 10000

// Rows still missing a publicId, split by whether the sweep's per-row UPDATE
// can address them at all. `addressable: false` counts rows with a NULL id —
// see the whereNotNull('id') note in the sweep.
const countMissingPublicIds = async (knex, tableName, addressable) => {
  const query = knex(tableName).whereNull('publicId')
  const result = await (
    addressable ? query.whereNotNull('id') : query.whereNull('id')
  )
    .count('* as cnt')
    .first()
  return Number(result.cnt)
}

// Terminating self-healing sweep, run after the forward keyset walk.
//
// The walk below is O(N) and resumable, but it only ever moves forward. The
// production flow runs `yarn migrate` against the live database while the
// currently deployed app — the PRE-publicId build, since migrate runs first —
// keeps serving traffic, and that app mints row ids with uniformly distributed
// uuid tails, so on a large table roughly half of the rows inserted during the
// (many-minute) walk land BEHIND the cursor and are never revisited by
// `where('id', '>', lastId)`.
//
// This pass is predicated on the condition being repaired (publicId IS NULL)
// rather than on a cursor position, so it converges regardless of insert
// order. The unique index added above covers NULLs on both SQLite and
// PostgreSQL, so the predicate stays cheap.
//
// Both early exits (no progress, pass bound) leave addressable rows behind. A
// migration whose up() RESOLVES is recorded in knex_migrations, and
// `knex migrate:latest` then skips it forever — so an exit that only logged
// "re-run the migration" would be a lie: the re-run reports "Already up to
// date" and repairs nothing. The completeness check at the end therefore
// THROWS on those two exits while addressable rows remain. knex records nothing
// on a failed migration, and up() is idempotent, so the next `yarn migrate`
// genuinely re-runs this migration and resumes the backfill.
//
// It does NOT throw on the converged exit. Converging proves the opposite of a
// stuck backfill: the last SELECT saw zero addressable NULL rows, so anything
// the completeness count finds afterwards was written after that SELECT, by the
// app running alongside this migration rather than by the backfill. Failing
// there would break a healthy online migration on a single concurrent insert —
// and the retry would pay another full O(N) forward walk only to race the same
// way — with a message that reads like corruption.
//
// What it must NOT claim is that those rows are fine. This migration does not
// backfill them, and in this project's deploy order most of them are written by
// a build that mints nothing: `yarn migrate` runs from a checkout against the
// live database while the PREVIOUS image serves traffic (the runtime image
// ships no Knex CLI — see docs/postgresql-setup.md), and that image predates
// publicId. The new build cannot go first either, since its INSERTs write a
// publicId value and need this column. So the residue keeps growing from the
// moment the sweep converges until the rollout finishes — no version of this
// migration could catch it — and nothing fills it in afterwards: publicId is
// only ever minted on insert, there is no lazy mint, and knex skips a recorded
// migration forever. The remedy is a POST-ROLLOUT pass with
// `scripts/maintenance/backfillPublicIds.ts` (see docs/maintenance.md), which is
// what the converged-exit message points the operator at.
const sweepMissingPublicIds = async (knex, tableName) => {
  let swept = 0
  let pass = 0
  let stopReason = 'converged'

  while (true) {
    if (pass >= MAX_SWEEP_PASSES) {
      stopReason = `hit the ${MAX_SWEEP_PASSES}-pass safety bound`
      console.log(`  ${tableName}: sweep ${stopReason}, stopping`)
      break
    }
    pass += 1

    // Deliberately unordered: an ORDER BY would force a sort and defeat the
    // index scan that makes this predicate cheap on a large table.
    const rows = await knex(tableName)
      .select('id', 'createdAt')
      .whereNull('publicId')
      // A NULL id cannot be addressed by the per-row UPDATE below: knex
      // compiles `.where('id', null)` to `id IS NULL`, which matches EVERY
      // null-id row at once, so a single publicId would be written to all of
      // them and the unique index would abort the migration. actors.id is
      // nullable in both schema dumps, so such rows can exist; they are
      // skipped here and reported at the end instead.
      .whereNotNull('id')
      .limit(BATCH_SIZE)
    if (rows.length === 0) break

    const filled = await bulkUpdatePublicIds(
      knex,
      tableName,
      rows.map((row) => ({
        id: row.id,
        publicId: mintPublicId(row.createdAt)
      }))
    )
    swept += filled
    console.log(
      `  ${tableName}: sweep pass ${pass} - ${filled}/${rows.length} filled (${swept} total)`
    )

    // Nothing in this migration ever clears publicId, so a pass that selects
    // NULL rows and changes none of them means the UPDATE is not taking
    // effect. Stop instead of re-selecting the same rows forever.
    if (filled === 0) {
      stopReason = `made no progress on ${rows.length} row(s)`
      console.log(`  ${tableName}: sweep ${stopReason}, stopping`)
      break
    }
  }

  console.log(
    `Sweep done. ${tableName}: ${swept} straggler(s) backfilled over ${pass} pass(es).`
  )

  const unaddressable = await countMissingPublicIds(knex, tableName, false)
  if (unaddressable > 0) {
    console.log(
      `  ${tableName}: ${unaddressable} row(s) with a NULL id were skipped and still have a NULL publicId; repair their id, then fill them with \`scripts/maintenance/backfillPublicIds.ts\` (see docs/maintenance.md) - re-running \`yarn migrate\` will not, since this migration is already recorded`
    )
  }

  const remaining = await countMissingPublicIds(knex, tableName, true)
  if (remaining > 0 && stopReason === 'converged') {
    // Not a failure, but not repaired either: rows written after the sweep's
    // last (empty) SELECT belong to the app writing alongside this migration,
    // and whether they carry a publicId depends on which build wrote them.
    console.log(
      `  ${tableName}: ${remaining} row(s) were inserted after the sweep converged and have a NULL publicId; this migration does NOT backfill them.`
    )
    console.log(
      `  ${tableName}: rows written by the still-deployed pre-publicId build stay NULL for good; only once the new build (which mints publicId on insert) is fully rolled out do new rows get one.`
    )
    console.log(
      `  ${tableName}: after the rollout completes, re-check and repair with \`scripts/maintenance/backfillPublicIds.ts\` (see docs/maintenance.md) - re-running \`yarn migrate\` will NOT, since this migration is already recorded.`
    )
  } else if (remaining > 0) {
    throw new Error(
      `${tableName}: ${remaining} row(s) still have a NULL publicId after ${pass} sweep pass(es) - the sweep ${stopReason}. Failing so this migration is not recorded as applied; up() is idempotent, so re-run \`yarn migrate\` to resume the backfill.`
    )
  }
}

const backfillPublicIds = async (knex, tableName) => {
  const totalResult = await knex(tableName).count('* as cnt').first()
  const total = Number(totalResult.cnt)
  console.log(`Backfilling publicId for ${total} ${tableName} rows...`)

  let lastId = ''
  let processed = 0
  let updated = 0

  while (true) {
    const rows = await knex(tableName)
      .select('id', 'createdAt', 'publicId')
      .where('id', '>', lastId)
      .orderBy('id')
      .limit(BATCH_SIZE)
    if (rows.length === 0) break

    lastId = rows[rows.length - 1].id

    updated += await bulkUpdatePublicIds(
      knex,
      tableName,
      rows
        .filter((row) => !row.publicId)
        .map((row) => ({
          id: row.id,
          publicId: mintPublicId(row.createdAt)
        }))
    )

    processed += rows.length
    console.log(
      `  ${tableName}: ${processed}/${total} (${total === 0 ? 100 : Math.round((processed / total) * 100)}%) - ${updated} updated`
    )
  }

  console.log(`Done. ${tableName}: processed ${processed}, updated ${updated}.`)

  await sweepMissingPublicIds(knex, tableName)
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function up(knex) {
  await addPublicIdColumn(knex, 'statuses', 'statuses_publicid_unique')
  await addPublicIdColumn(knex, 'actors', 'actors_publicid_unique')
  await backfillPublicIds(knex, 'statuses')
  await backfillPublicIds(knex, 'actors')
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function down(knex) {
  for (const [tableName, indexName] of [
    ['statuses', 'statuses_publicid_unique'],
    ['actors', 'actors_publicid_unique']
  ]) {
    // Checked independently, matching up()'s two-step idempotency: a prior
    // interrupted run may have left the column without the index.
    if (await hasIndex(knex, tableName, indexName)) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropUnique(['publicId'], indexName)
      })
    }

    const hasColumn = await knex.schema.hasColumn(tableName, 'publicId')
    if (hasColumn) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropColumn('publicId')
      })
    }
  }
}

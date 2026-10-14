// Pure helpers for the route heatmap pyramid: the row mappers, the claim's
// decision in JavaScript and the same decision as the WHERE clauses its
// compare-and-swap re-asserts, and the viewport window. No database access.
import crypto from 'crypto'
import type {
  ExpressionBuilder,
  SelectQueryBuilder,
  Selectable,
  UpdateQueryBuilder,
  UpdateResult
} from 'kysely'

import type { FitnessRouteHeatmapTileRangeParams } from '@/lib/database/domains/fitnessRouteHeatmapTile/types'
import type { DB } from '@/lib/database/kysely'
import type {
  FitnessRouteHeatmapPyramids,
  FitnessRouteHeatmapTiles
} from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import type {
  FitnessRouteHeatmapPyramid,
  FitnessRouteHeatmapPyramidStatus,
  FitnessRouteHeatmapTileRow
} from '@/lib/types/database/fitnessRouteHeatmapTile'

export type FitnessRouteHeatmapPyramidRow =
  Selectable<FitnessRouteHeatmapPyramids>
export type FitnessRouteHeatmapTileStoredRow =
  Selectable<FitnessRouteHeatmapTiles>

type PyramidUpdate = UpdateQueryBuilder<
  DB,
  'fitness_route_heatmap_pyramids',
  'fitness_route_heatmap_pyramids',
  UpdateResult
>

/**
 * A pyramid row as the domain `FitnessRouteHeatmapPyramid`. The driver has
 * already read the timestamps as epoch milliseconds, on both backends.
 */
export const toFitnessRouteHeatmapPyramid = (
  row: FitnessRouteHeatmapPyramidRow
): FitnessRouteHeatmapPyramid => ({
  id: row.id,
  actorId: row.actorId,
  status: row.status as FitnessRouteHeatmapPyramidStatus,
  error: row.error ?? undefined,
  version: Number(row.version ?? 0),
  claimSeq: Number(row.claimSeq ?? 0),
  totalCount: Number(row.totalCount ?? 0),
  scannedCount: Number(row.scannedCount ?? 0),
  activityCount: Number(row.activityCount ?? 0),
  tileCount: Number(row.tileCount ?? 0),
  pointCount: Number(row.pointCount ?? 0),
  // Both halves or neither: a cursor missing its id cannot resume a keyset
  // scan, so it is no cursor at all.
  //
  // Tested for null rather than for truthiness, and `applyResumePremiseFilter`
  // asks SQL the same question, because the two must agree exactly — a state
  // one of them calls resumable and the other does not is a row whose claim can
  // never match, wedging the actor's pyramid for good. Truthiness disagreed on
  // two counts: an epoch-0 `cursorCreatedAt` is a falsy number (the driver
  // reads it as 0 on both backends), and an empty `cursorId` is falsy in JS
  // while `IS NULL` in SQL is false.
  cursor:
    row.cursorCreatedAt !== null &&
    row.cursorCreatedAt !== undefined &&
    row.cursorId !== null &&
    row.cursorId !== undefined
      ? {
          createdAt: row.cursorCreatedAt,
          id: row.cursorId
        }
      : undefined,
  // Null-tested, not truthiness-tested, for the reason spelled out above the
  // cursor: an epoch-0 timestamp is a falsy 0, so a truthiness test would read
  // a completion at the epoch as no completion at all. `completedAt` reaches
  // `classifyPyramidForClaim`, which is the decision that either serves a
  // request from a finished pyramid or rebuilds it.
  completedAt:
    row.completedAt !== null && row.completedAt !== undefined
      ? row.completedAt
      : undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

/** A tile row as the domain `FitnessRouteHeatmapTileRow`. */
export const toFitnessRouteHeatmapTileRow = (
  row: FitnessRouteHeatmapTileStoredRow
): FitnessRouteHeatmapTileRow => ({
  actorId: row.actorId,
  tileKey: row.tileKey,
  z: Number(row.z),
  x: Number(row.x),
  y: Number(row.y),
  version: Number(row.version ?? 0),
  segments: row.segments ?? '',
  pointCount: Number(row.pointCount ?? 0),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

/**
 * The values of a pyramid row nobody has built into yet. The claim creates it
 * on first use, and the per-actor delete creates it so that its DELETE always
 * has a row to lock.
 */
export const newPyramidRow = (
  actorId: string,
  createdAt: Date,
  updatedAt: Date
) => ({
  id: crypto.randomUUID(),
  actorId,
  status: 'idle',
  error: null,
  version: 0,
  claimSeq: 0,
  totalCount: 0,
  scannedCount: 0,
  activityCount: 0,
  tileCount: 0,
  pointCount: 0,
  cursorCreatedAt: null,
  cursorId: null,
  completedAt: null,
  createdAt,
  updatedAt
})

/**
 * Whether the caller is presenting this exact build's current token — the row
 * it was handed AND the sequence value it held. Both halves matter: `claimSeq`
 * counts from zero per row and clearing an actor's heatmaps deletes the row, so
 * the first claim before a clear and the first claim after it both hold token
 * 1, and matching on the sequence alone lets a stranded pass evict the live
 * build that replaced it.
 */
export const isOwnContinuation = (
  pyramid: FitnessRouteHeatmapPyramid,
  resumeBuild?: { pyramidId: string; claimSeq: number }
) =>
  resumeBuild !== undefined &&
  resumeBuild.pyramidId === pyramid.id &&
  resumeBuild.claimSeq === pyramid.claimSeq

/**
 * Whether a claim may take this pyramid, and if not, why. Shared by the claim's
 * read (which needs the reason) and mirrored in SQL by `applyClaimableFilter`
 * (which needs the same test to hold at the moment of the write). Keeping one
 * function for the JS side means a rule can only drift from the SQL, not from
 * itself.
 */
export const classifyPyramidForClaim = (
  pyramid: FitnessRouteHeatmapPyramid,
  requestedAt: number,
  staleBefore: number,
  resumeBuild?: { pyramidId: string; claimSeq: number }
): 'already-fresh' | 'build-in-progress' | 'claimable' => {
  if (
    pyramid.status === 'completed' &&
    pyramid.completedAt !== undefined &&
    pyramid.completedAt >= requestedAt
  ) {
    return 'already-fresh'
  }

  // A continuation carrying this very build's live token is its own next pass,
  // not a competitor for it, so the liveness test does not apply to it.
  if (
    pyramid.status === 'generating' &&
    pyramid.updatedAt >= staleBefore &&
    !isOwnContinuation(pyramid, resumeBuild)
  ) {
    return 'build-in-progress'
  }

  return 'claimable'
}

/**
 * `classifyPyramidForClaim(...) === 'claimable'` as a WHERE clause, so the
 * claim's compare-and-swap asserts the state its decision was made on instead
 * of trusting it to still hold.
 *
 * Written as the De Morgan expansion of "not fresh AND not in progress" rather
 * than two negated groups, because `completedAt` is nullable: `NOT (status =
 * 'completed' AND completedAt >= ?)` evaluates to NULL — and so excludes the
 * row — for a completed build that never stamped a completion time, which is
 * exactly a row a claim should be free to take over.
 */
export const applyClaimableFilter = (
  query: PyramidUpdate,
  requestedAt: number,
  staleBefore: number,
  resumeBuild?: { pyramidId: string; claimSeq: number }
) =>
  query
    .where((eb) =>
      eb.or([
        eb('status', '<>', 'completed'),
        eb('completedAt', 'is', null),
        eb('completedAt', '<', timestampValue(requestedAt))
      ])
    )
    .where((eb) =>
      eb.or([
        eb('status', '<>', 'generating'),
        eb('updatedAt', '<', timestampValue(staleBefore)),
        ...(resumeBuild ? [ownContinuation(eb, resumeBuild)] : [])
      ])
    )

const ownContinuation = (
  eb: ExpressionBuilder<DB, 'fitness_route_heatmap_pyramids'>,
  resumeBuild: { pyramidId: string; claimSeq: number }
) =>
  eb.and([
    eb('id', '=', resumeBuild.pyramidId),
    eb('claimSeq', '=', resumeBuild.claimSeq)
  ])

/**
 * Re-asserts the premise the claim's `resumed` and `version` decision rests on:
 * a resume needs the row to still be a `generating` build with a cursor to pick
 * up from, and a fresh claim needs it to still NOT be one.
 *
 * Separate from `applyClaimableFilter` because the two answer different
 * questions. That one only rules a state out — not already fresh, not still
 * running — and every terminal status satisfies it equally. This one rules a
 * state IN. Without it an incumbent that wakes in the claim's window and writes
 * its terminal state (`status: 'failed'`, `cursor: null`, guarded on a token it
 * still holds) leaves the compare-and-swap matching on a premise that no longer
 * exists: the winner is told it resumed, keeps the previous build's version,
 * and finds no cursor — so it rescans from the beginning INTO that build's own
 * tiles, doubling every count it revisits, and completion cannot sweep the
 * leftovers because the version never moved.
 *
 * Both cursor columns are tested, exactly as `toFitnessRouteHeatmapPyramid`
 * does. Checking only `cursorId` made a half-written cursor a state SQL called
 * resumable and JS did not, and neither branch of this filter can then match:
 * the claim answers `lost-race` on every attempt, forever, with no way back
 * because clearing the cursor needs a token nobody holds.
 */
export const applyResumePremiseFilter = (
  query: PyramidUpdate,
  resumed: boolean
) => {
  if (!resumed) {
    // A fresh claim bumps the version and clears the cursor, which is a valid
    // start from ANY state `applyClaimableFilter` already allowed — so there is
    // no premise here to re-assert. Asserting "not resumable" anyway is what
    // made the statement miss the abandoned `generating` row that still holds a
    // cursor, which is precisely the row a fresh build has to be able to take
    // over: the claim then failed on every attempt forever, with no way to
    // clear the cursor because nobody could own the row.
    return query
  }

  // A resume keeps the build's version and adds to its tiles, so it needs the
  // row to still BE that build: still generating, still holding the cursor it
  // will carry on from. An incumbent that wakes in the claim's window and
  // writes its terminal state moves neither the token nor the version, so
  // without this the winner is told it resumed, finds no cursor, and rescans
  // from the beginning into that build's own tiles — doubling every count it
  // revisits, with no version change for the sweep to catch.
  return query
    .where('status', '=', 'generating')
    .where('cursorCreatedAt', 'is not', null)
    .where('cursorId', 'is not', null)
}

/**
 * A rectangular window of one zoom level. `between` means the caller owns
 * splitting a viewport that wraps the antimeridian: at `minX > maxX` this
 * matches nothing rather than wrapping around, so a Pacific-straddling map
 * would silently come back empty.
 */
export const applyTileRange = <O>(
  query: SelectQueryBuilder<DB, 'fitness_route_heatmap_tiles', O>,
  { actorId, z, minX, maxX, minY, maxY }: FitnessRouteHeatmapTileRangeParams
) =>
  query
    .where('actorId', '=', actorId)
    .where('z', '=', z)
    .where((eb) => eb.between('x', minX, maxX))
    .where((eb) => eb.between('y', minY, maxY))

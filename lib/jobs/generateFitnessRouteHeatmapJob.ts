import { z } from 'zod'

import { getFitnessRouteHeatmapConfig } from '@/lib/config/fitnessRouteHeatmap'
import { Database } from '@/lib/database/types'
import {
  type RegionBounds,
  deserializeRegions,
  getRegionBounds
} from '@/lib/fitness/regions'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import {
  FITNESS_FILE_ROUTE_SOURCE_VERSION,
  buildFitnessFileRoutePoints
} from '@/lib/services/fitness-files/fileRouteCache'
import {
  type TileEdgeMap,
  mergeTileDelta
} from '@/lib/services/fitness-files/heatmapTiles/edgeMerge'
import {
  countTilePoints,
  decodeTile,
  encodeTile,
  parseTileKey
} from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import {
  type TileDelta,
  buildTileDeltasForActivity
} from '@/lib/services/fitness-files/heatmapTiles/tiler'
import type {
  FitnessCoordinate,
  ParseableFitnessFileType
} from '@/lib/services/fitness-files/parseFitnessFile'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import {
  annotatePointsWithPrivacy,
  buildPrivacySegments,
  downsamplePrivacySegments,
  getFitnessPrivacyLocations
} from '@/lib/services/fitness-files/privacy'
import type { PrivacySegment } from '@/lib/services/fitness-files/privacy'
import {
  DEFAULT_ROUTE_HEATMAP_MAX_POINTS,
  buildRouteHeatmapPayload,
  splitSegmentByBounds
} from '@/lib/services/fitness-files/routeHeatmap'
import type { RouteHeatmapPoint } from '@/lib/services/fitness-files/routeHeatmap'
import { getQueue } from '@/lib/services/queue'
import type { JobMessage } from '@/lib/services/queue/type'
import type { FitnessFileRoute } from '@/lib/types/database/fitnessFileRoute'
import type { FitnessRouteHeatmapSegment } from '@/lib/types/database/fitnessRouteHeatmap'
import type {
  FitnessRouteHeatmapPyramidClaim,
  FitnessRouteHeatmapPyramidCursor
} from '@/lib/types/database/fitnessRouteHeatmapTile'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { createJobHandle } from './createJobHandle'

// Each generation pass must finish (and checkpoint) well inside the queue's
// per-job timeout. QStash caps a job at 30s (MAX_JOB_TIMEOUT_SECONDS); we stop
// accumulating at 20s and spend the remaining headroom persisting the
// checkpoint payload and publishing the continuation, keeping wall-clock under
// the ~25s-per-task target. Anything longer is split into a continuation job.
export const ROUTE_HEATMAP_JOB_TIME_BUDGET_MS = 20_000
const ROUTE_HEATMAP_PAGE_SIZE = 100
// How many cached routes to read ahead within a page. Ten keeps the worst-case
// live set (10 x `filePointLimit` = 800,000 points, ~40 MB of tuples) at the
// same order as the single raw parse this job held before the cache existed,
// while still collapsing a page's storage reads into ten indexed lookups.
export const ROUTE_CACHE_PREFETCH_SIZE = 10
const ROUTE_HEATMAP_MAX_FILES = 1_000_000
const QUEUE_PUBLISH_MAX_ATTEMPTS = 3

/**
 * How long a pyramid build may go without a heartbeat before another pass may
 * take it over. Six times the job's own 20s budget, so a pass that is simply
 * working — every tile flush heartbeats — is never reclaimed, while one whose
 * worker died is picked up on the next request rather than blocking the actor
 * forever.
 */
export const PYRAMID_HEARTBEAT_STALE_MS = 120_000

/**
 * How many tiles may sit unflushed in the delta map before it is written out,
 * regardless of the time budget.
 *
 * The map holds an edge set per touched tile, and a build sweeping a dense city
 * touches tiles far faster than the 20s checkpoint arrives. This is the bound
 * on that growth between flushes, and it costs one read plus one chunked
 * upsert.
 *
 * It bounds TILES, not edges, and nothing bounds the edges within a tile — so
 * what the map actually costs varies by two orders of magnitude with route
 * density. Measured by folding synthetic rides through the real tiler and
 * reading `heapUsed` around a forced GC: ~150 bytes per edge, which is 5 MB for
 * 8,000 sparse tiles (3.4 edges each) and extrapolates to ~265 MB for 8,000
 * tiles at the 235-edges-each density of a repeatedly-ridden city. The 512 MB
 * heap guard is what keeps the dense end safe, not this constant; raising it
 * moves the dense end, not the sparse one.
 */
export const TILE_FLUSH_PENDING_LIMIT = 8_000

const JobData = z.object({
  actorId: z.string(),
  activityType: z.string().nullable(),
  periodType: z.enum(['all_time', 'yearly', 'monthly']),
  periodKey: z.string(),
  region: z.string().nullable().optional(),
  resume: z.boolean().optional(),
  cursorOffset: z.number().int().nonnegative().optional(),
  maxCursorOffset: z.number().int().positive().optional(),
  requestedAt: z.number().int().nonnegative().optional(),
  /**
   * The tile build's ownership token, carried forward by a continuation this
   * job published for itself. It is what lets the next pass re-adopt the build
   * its predecessor was mid-way through: flushing is the heartbeat, so a pass
   * that has just checkpointed leaves a `generating` pyramid that its own
   * continuation would otherwise read as somebody else's live build.
   *
   * Absent on a request that came from the API, which is exactly right — an
   * operator-triggered generate is a competitor for the build and has to win
   * the claim on the usual terms. `resume: true` on its own is NOT this token:
   * the heatmap API sets it for any retry of a failed or partial region row,
   * carrying that row's offset and no pyramid token at all.
   *
   * Positive, never zero: a claim writes `pyramid.claimSeq + 1` onto a row that
   * starts at zero, so every token a build was ever handed is at least 1.
   */
  pyramidClaimSeq: z.number().int().positive().optional(),
  /**
   * The pyramid ROW the token belongs to. Clearing an actor's heatmaps deletes
   * that row and the next one starts its sequence from zero, so the token alone
   * would let a continuation from before the clear match an unrelated build
   * after it — and evict the live pass that owned it.
   */
  pyramidBuildId: z.string().optional()
})

const getPeriodRange = (
  periodType: string,
  periodKey: string
): { periodStart: Date; periodEnd: Date } => {
  switch (periodType) {
    case 'yearly': {
      const year = parseInt(periodKey, 10)
      return {
        periodStart: new Date(Date.UTC(year, 0, 1)),
        periodEnd: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
      }
    }
    case 'monthly': {
      const [year, month] = periodKey.split('-').map(Number)
      const periodStart = new Date(Date.UTC(year, month - 1, 1))
      const nextMonth = new Date(Date.UTC(year, month, 1))
      const periodEnd = new Date(nextMonth.getTime() - 1)
      return { periodStart, periodEnd }
    }
    default: {
      return {
        periodStart: new Date(Date.UTC(1970, 0, 1)),
        periodEnd: new Date(Date.UTC(2100, 11, 31, 23, 59, 59, 999))
      }
    }
  }
}

const getFitnessFileBuffer = async (
  database: Database,
  fitnessFileId: string
): Promise<Buffer> => {
  const data = await getFitnessFile(database, fitnessFileId)
  if (!data) {
    throw new Error('Fitness file not found in storage')
  }

  if (data.type === 'buffer') {
    return data.buffer
  }

  const response = await fetch(data.redirectUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to download fitness file from redirect URL (${response.status})`
    )
  }

  return Buffer.from(await response.arrayBuffer())
}

const applyRegionFilter = (
  privacySegments: Array<PrivacySegment<RouteHeatmapPoint>>,
  regionBounds: RegionBounds[]
) => {
  if (regionBounds.length === 0) {
    return privacySegments.filter((segment) => segment.points.length >= 2)
  }

  return privacySegments
    .flatMap((segment) => splitSegmentByBounds(segment, regionBounds))
    .filter((segment) => segment.points.length >= 2)
}

const countSegmentPoints = (
  segments: Array<PrivacySegment<RouteHeatmapPoint>>
) =>
  segments.reduce((sum, segment) => {
    return sum + segment.points.length
  }, 0)

const toPrivacySegments = (
  segments: FitnessRouteHeatmapSegment[]
): Array<PrivacySegment<RouteHeatmapPoint>> =>
  segments
    .map((segment) => {
      const isHiddenByPrivacy = Boolean(segment.isHiddenByPrivacy)
      return {
        isHiddenByPrivacy,
        points: segment.points.map((point) => ({
          ...point,
          isHiddenByPrivacy
        }))
      }
    })
    .filter((segment) => segment.points.length >= 2)

const downsampleSegmentsForCache = (
  segments: Array<PrivacySegment<RouteHeatmapPoint>>,
  maxPoints = DEFAULT_ROUTE_HEATMAP_MAX_POINTS
) =>
  downsamplePrivacySegments(segments, maxPoints, {
    minimumPointsPerSegment: 2
  }).filter((segment) => segment.points.length >= 2)

/**
 * The activity's route, taken from `fitness_file_routes` when a usable row is
 * cached for it and derived from the source file otherwise. A miss re-derives
 * and writes through, so the second run over the same activity is a hit.
 *
 * Both branches end in `buildFitnessFileRoutePoints`, which is the point: a
 * heatmap must not come out differently depending on whether a cache row
 * happened to exist. An empty result is a real answer — the activity has no
 * GPS — and a cached empty row is what keeps a treadmill-heavy history from
 * paying a download per run to rediscover that.
 */
const resolveRouteCoordinates = async (
  database: Database,
  {
    actorId,
    fitnessFileId,
    fileType,
    cachedRoute
  }: {
    actorId: string
    fitnessFileId: string
    fileType: ParseableFitnessFileType
    cachedRoute: FitnessFileRoute | undefined
  }
): Promise<FitnessCoordinate[]> => {
  // `pointCount` is what tells a real empty route apart from an unreadable one.
  // `parseRoutePoints` answers `[]` for a payload it cannot decode — the row
  // parser's documented "a corrupt payload is a cache miss" — but by the time
  // it reaches here that is byte-identical to the negative-cache row a
  // GPS-less activity legitimately writes. Without this check a single
  // unreadable row would be served as a permanent hit and its activity would
  // silently vanish from every heatmap until the file was reprocessed.
  const isUsableCachedRoute =
    cachedRoute !== undefined &&
    cachedRoute.sourceVersion === FITNESS_FILE_ROUTE_SOURCE_VERSION &&
    cachedRoute.points.length === cachedRoute.pointCount

  if (isUsableCachedRoute) {
    return cachedRoute.points.map(([lat, lng]) => ({ lat, lng }))
  }

  const buffer = await getFitnessFileBuffer(database, fitnessFileId)
  const activityData = await parseFitnessFile({ fileType, buffer })
  const points = buildFitnessFileRoutePoints(activityData.coordinates)

  try {
    await database.upsertFitnessFileRoute({
      fitnessFileId,
      actorId,
      points,
      sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
    })
  } catch (error) {
    // The route is already in hand, so a failed write costs this run nothing —
    // only the next one, which pays the download again. Letting it escape would
    // instead drop a perfectly good activity out of the heatmap, because the
    // caller treats a throw here as an unreadable file.
    logger.warn({
      message: 'Failed to cache the fitness file route during generation',
      actorId,
      fitnessFileId,
      err: toLoggableError(error)
    })
  }

  return points.map(([lat, lng]) => ({ lat, lng }))
}

const shouldReduceAccumulation = (
  pointCount: number,
  routeHeatmapConfig: ReturnType<typeof getFitnessRouteHeatmapConfig>
) => {
  if (pointCount >= routeHeatmapConfig.accumulationPointLimit) {
    return true
  }

  // Bound on *live* allocation, not rss. heapUsed alone misses the per-file
  // download buffers and parser scratch space, which live off-heap; `external`
  // covers exactly that native/ArrayBuffer memory (Node reports `arrayBuffers`
  // as a subset already included in `external`, so summing both would double
  // count). rss would over-count here — it includes pages V8 has freed but not
  // yet returned to the OS, tripping downsampling prematurely.
  const memory = process.memoryUsage()
  return (
    memory.heapUsed + memory.external > routeHeatmapConfig.memoryBudgetBytes
  )
}

const shouldCheckpoint = (startedAt: number) =>
  Date.now() - startedAt >= ROUTE_HEATMAP_JOB_TIME_BUDGET_MS

const publishJobWithRetry = async (jobMessage: JobMessage) => {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= QUEUE_PUBLISH_MAX_ATTEMPTS; attempt += 1) {
    try {
      await getQueue().publish(jobMessage)
      return
    } catch (error) {
      lastError = error as Error
      if (attempt < QUEUE_PUBLISH_MAX_ATTEMPTS) {
        logger.warn({
          message: 'Retrying fitness route heatmap continuation publish',
          attempt,
          error: lastError.message
        })
      }
    }
  }

  throw lastError ?? new Error('Failed to publish route heatmap continuation')
}

export const generateFitnessRouteHeatmapJob = createJobHandle(
  GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
  async (database, message) => {
    const {
      actorId,
      activityType,
      periodType,
      periodKey,
      region,
      resume,
      cursorOffset: requestedCursorOffset,
      maxCursorOffset: requestedMaxCursorOffset,
      requestedAt,
      pyramidClaimSeq,
      pyramidBuildId
    } = JobData.parse(message.data)

    const startedAt = Date.now()
    const routeHeatmapConfig = getFitnessRouteHeatmapConfig()
    const normalizedRegion = region?.trim() || ''
    const regionBounds = getRegionBounds(deserializeRegions(normalizedRegion))
    const { periodStart, periodEnd } = getPeriodRange(periodType, periodKey)

    let heatmapId: string | undefined
    // Hoisted for the same reason `heatmapId` is: the failure path below has to
    // release a build it may have claimed.
    let pyramidBuild: {
      pyramidId: string
      claimSeq: number
      version: number
      cursor: FitnessRouteHeatmapPyramidCursor | null
    } | null = null

    const isResume = resume === true

    /**
     * The tile build this pass was handed by its own predecessor, if any.
     *
     * Presenting it is the ONLY way to resume a build rather than start a fresh
     * one — `resume: true` on its own is not this, because the heatmap API sets
     * that for any retry of a failed or partial region row, carrying that row's
     * offset and no pyramid token at all.
     */
    const carriedPyramidBuild =
      isResume && pyramidBuildId && pyramidClaimSeq !== undefined
        ? { pyramidId: pyramidBuildId, claimSeq: pyramidClaimSeq }
        : undefined

    /**
     * Why this pass walked away from the build it was carrying, for the row's
     * own error column. Only ever read when the release below actually matches.
     */
    let carriedBuildDropReason =
      'Continuation ended without taking over the build it carried'

    /**
     * Hands a build back rather than sitting on it.
     *
     * A claim has already stamped the row `generating` with a fresh heartbeat,
     * so a pass that then decides it must not fold would otherwise leave a
     * live-looking build with no writer, and every other claimant is refused
     * until the staleness window lapses. Recording why on the row is also the
     * only signal scoped to what actually broke — the region row says nothing
     * about the pyramid.
     *
     * Fenced on the token, so a build that has already been taken over is
     * untouched by a late release.
     */
    const releasePyramidBuild = async (
      build: { pyramidId: string; claimSeq: number },
      reason: string,
      // `failed` for anything that went wrong, but a user cancellation is not a
      // failure and the row has a status that says so. Without this the
      // `cancelled` state is unreachable and the row cannot tell an operator
      // that nothing is wrong with their data.
      status: 'failed' | 'cancelled' = 'failed'
    ) => {
      try {
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          pyramidId: build.pyramidId,
          claimSeq: build.claimSeq,
          status,
          error: reason
        })
      } catch (releaseError) {
        logger.warn({
          message: 'Failed to release the route heatmap pyramid build',
          actorId,
          err: toLoggableError(releaseError)
        })
      }
    }

    try {
      const actor = await database.getActorFromId({ id: actorId })
      if (!actor) {
        throw new Error('Actor not found')
      }

      const existing = await database.getFitnessRouteHeatmapByKey({
        actorId,
        activityType,
        periodType,
        periodKey,
        region: normalizedRegion,
        includeDeleted: true
      })

      /**
       * Records why this pass is walking away from the build it carried. The
       * release itself happens in the `finally` below, on EVERY exit — four
       * separate guards drop a continuation, and a per-guard release was missed
       * on one of them twice. It is safe to run unconditionally because it is
       * fenced on the carried token, which a claim always moves: once this pass
       * (or anyone else) has taken the build over, the release matches nothing.
       */
      const dropCarriedPyramidBuild = (reason: string) => {
        carriedBuildDropReason = reason
      }

      if (existing?.deletedAt) {
        const canRestoreDeleted =
          !isResume &&
          requestedAt !== undefined &&
          requestedAt >= existing.deletedAt
        if (!canRestoreDeleted) {
          logger.info({
            message: 'Skipping stale route heatmap generation',
            actorId,
            periodType,
            periodKey,
            requestedAt,
            deletedAt: existing.deletedAt,
            status: existing.status
          })
          dropCarriedPyramidBuild(
            'Continuation dropped; its region row was deleted'
          )
          return
        }
      }

      // A cancel that landed while this job was queued must win at the start too:
      // the initial claim write is unguarded (a fresh retry must be able to
      // reclaim a cancelled row), so a stale job whose requestedAt predates the
      // cancellation would otherwise resurrect it (e.g. an at-least-once
      // redelivery of the original job). Mirror the soft-delete staleness guard:
      // only a non-resume run requested at/after the cancel may reclaim it.
      if (existing && !existing.deletedAt && existing.status === 'cancelled') {
        const canReclaimCancelled =
          !isResume &&
          requestedAt !== undefined &&
          requestedAt >= existing.updatedAt
        if (!canReclaimCancelled) {
          logger.info({
            message:
              'Skipping stale route heatmap generation after cancellation',
            actorId,
            periodType,
            periodKey,
            requestedAt,
            cancelledAt: existing.updatedAt
          })
          dropCarriedPyramidBuild(
            'Continuation dropped; generation was cancelled'
          )
          return
        }
      }

      const canResumeExisting =
        existing &&
        (['generating', 'failed'].includes(existing.status) ||
          (existing.status === 'completed' && existing.isPartial))
      if (
        isResume &&
        (!existing ||
          !canResumeExisting ||
          existing.deletedAt ||
          requestedCursorOffset !== existing.cursorOffset)
      ) {
        logger.info({
          message: 'Skipping stale route heatmap continuation',
          actorId,
          periodType,
          periodKey,
          requestedCursorOffset,
          currentCursorOffset: existing?.cursorOffset,
          status: existing?.status ?? 'missing'
        })
        dropCarriedPyramidBuild(
          'Continuation dropped; its region row had moved on'
        )
        return
      }

      let cursorOffset = 0
      let allSegments: Array<PrivacySegment<RouteHeatmapPoint>> = []
      let allSegmentPointCount = 0
      let activityCount = 0
      let maxCursorOffsetForRun =
        requestedMaxCursorOffset ??
        Math.max(
          ROUTE_HEATMAP_MAX_FILES,
          (requestedCursorOffset ?? 0) + ROUTE_HEATMAP_MAX_FILES
        )

      const queryFilters = {
        actorId,
        processingStatus: 'completed' as const,
        isPrimary: true,
        ...(activityType !== null ? { activityType } : {}),
        ...(periodType !== 'all_time'
          ? { startDate: periodStart, endDate: periodEnd }
          : {})
      }

      // Progress denominator: total matching files this run must scan. Recomputed
      // each run (fresh or resume) so the reported total reflects files added or
      // removed since the heatmap was first queued.
      const totalCount = await database.countFitnessFilesByActor(queryFilters)

      if (existing) {
        heatmapId = existing.id
        if (isResume) {
          cursorOffset = existing.cursorOffset
          allSegments = toPrivacySegments(existing.segments)
          allSegmentPointCount = countSegmentPoints(allSegments)
          activityCount = existing.activityCount
        }
        const markedGenerating = await database.updateFitnessRouteHeatmapStatus(
          {
            id: existing.id,
            status: 'generating',
            error: null,
            totalCount,
            clearDeleted: true,
            clearDeletedBefore: requestedAt ?? 0,
            ...(isResume
              ? {}
              : {
                  bounds: null,
                  segments: null,
                  activityCount: 0,
                  pointCount: 0,
                  cursorOffset: 0,
                  isPartial: false
                })
          }
        )
        if (!markedGenerating) {
          logger.info({
            message:
              'Skipping stale route heatmap generation after cache clear',
            actorId,
            periodType,
            periodKey,
            requestedAt,
            status: existing.status
          })
          dropCarriedPyramidBuild(
            'Continuation dropped; its region row was cleared'
          )
          return
        }
      } else {
        const created = await database.createFitnessRouteHeatmap({
          actorId,
          activityType,
          periodType,
          periodKey,
          region: normalizedRegion,
          periodStart,
          periodEnd
        })
        heatmapId = created.id
        await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'generating',
          error: null,
          totalCount,
          cursorOffset: 0,
          isPartial: false
        })
      }

      if (!heatmapId) {
        throw new Error('Route heatmap cache row not available')
      }
      const routeHeatmapId = heatmapId

      const privacySettings = await database.getFitnessSettings({
        actorId,
        serviceType: 'general'
      })
      const privacyLocations = getFitnessPrivacyLocations(privacySettings)

      let reachedPageLimit = false

      // The pyramid is per-actor and covers the all-activities/all-time
      // dataset, so only that variant builds it. Region is orthogonal: tiles
      // are stored unclipped and a region is applied when they are served, so
      // whichever region row wins the claim builds the same pyramid.
      const isPyramidVariant =
        activityType === null && periodType === 'all_time'

      // `startedAt`, never a fresh `Date.now()` — the checkpoint tests stub the
      // clock with `mockReturnValueOnce(0)` and assume the first call in a run
      // is the one at the top of this handler.
      //
      // The claim can throw when a clear keeps deleting the row underneath it.
      // That is a pyramid-only problem, and the legacy blob this run also owes
      // the user does not deserve to fail with it.
      // A build covers either the whole history or exactly the part its cursor
      // says it has reached, and only two kinds of pass can supply that: one
      // scanning from the beginning, and one carrying the build's own token.
      // Anything else — the heatmap API's retry of a failed or partial region
      // row, which sets `resume: true` with that row's offset and no pyramid
      // token — must not claim AT ALL, because the claim is destructive: its
      // compare-and-swap bumps `version`, stamps `generating`, and clears the
      // counters, the cursor and `completedAt`. Deciding afterwards that the
      // pass cannot use what it took is too late; it has already demoted a
      // perfectly good completed pyramid to a failed, empty one over tiles it
      // no longer describes, and rebuilt nothing.
      const canOwnPyramidBuild =
        carriedPyramidBuild !== undefined || (requestedCursorOffset ?? 0) === 0

      let pyramidClaim: FitnessRouteHeatmapPyramidClaim | null = null
      if (isPyramidVariant && !canOwnPyramidBuild) {
        logger.info({
          message:
            'Skipping the route heatmap tile build; this pass could not own one',
          actorId,
          requestedCursorOffset: requestedCursorOffset ?? 0
        })
      }
      if (isPyramidVariant && canOwnPyramidBuild) {
        try {
          pyramidClaim = await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: requestedAt ?? startedAt,
            staleBefore: startedAt - PYRAMID_HEARTBEAT_STALE_MS,
            // The token this run's own predecessor handed it, and the only way
            // to resume a build rather than start a fresh one. It names the
            // pyramid ROW as well as the sequence, because clearing an actor's
            // heatmaps deletes the row and the next build counts from zero
            // again — `claimSeq` alone would let a continuation from before the
            // clear match a different build after it and evict the live pass
            // that owned it.
            ...(carriedPyramidBuild ? { resumeBuild: carriedPyramidBuild } : {})
          })
        } catch (claimError) {
          logger.warn({
            message: 'Failed to claim the route heatmap pyramid build',
            actorId,
            err: toLoggableError(claimError)
          })
        }
      }

      // Tile work runs beside the legacy blob and is allowed to stop at any
      // point without touching it. Anything other than owning the build — a
      // fresher pyramid already answers this request, another pass holds it, or
      // the claim lost its race — simply leaves the legacy path running alone.
      if (pyramidClaim?.claimed && pyramidClaim.reason === 'claimed') {
        const claimed = {
          pyramidId: pyramidClaim.pyramid.id,
          claimSeq: pyramidClaim.pyramid.claimSeq,
          version: pyramidClaim.pyramid.version,
          cursor: pyramidClaim.pyramid.cursor ?? null
        }

        // A build covers either the whole history or exactly the part its
        // cursor says it has reached, and this run has to be able to supply
        // that. A fresh build has seen nothing, so it needs a scan that starts
        // from the beginning; a resumed one carries on from its cursor, and
        // `resumed` now means the claim honoured this run's own continuation
        // token — the only evidence that it is that build's next pass.
        //
        // Reading `resumed` as "the caller said resume" is what made this
        // wrong before: a retry of a failed region row says exactly that,
        // arrives with that row's non-zero offset and no pyramid token, and
        // would adopt an abandoned build, skip every activity before its
        // offset, and then mark the pyramid completed over the hole.
        if (pyramidClaim.resumed || (requestedCursorOffset ?? 0) === 0) {
          pyramidBuild = claimed
        } else {
          logger.info({
            message:
              'Skipping route heatmap tile build; this pass cannot cover the claimed build',
            actorId,
            resumedCursorOffset: requestedCursorOffset ?? 0
          })
          await releasePyramidBuild(
            claimed,
            'Claimed by a pass that could not cover the build'
          )
        }
      }

      // Files this build has scanned and folded, carried across continuations
      // so the pyramid reports its own progress rather than the region row's.
      let pyramidScannedCount = pyramidBuild
        ? (pyramidClaim?.pyramid.scannedCount ?? 0)
        : 0
      let pyramidActivityCount = pyramidBuild
        ? (pyramidClaim?.pyramid.activityCount ?? 0)
        : 0
      let flushedScannedCount = pyramidScannedCount

      // tileKey -> the edges this run has folded in but not yet written.
      const pendingTiles = new Map<string, TileEdgeMap>()

      /**
       * Whether the build still has to fold this activity.
       *
       * The scan runs `(createdAt, id)` DESCENDING, and the build's cursor is
       * the last file it took, so anything sorting at or after that cursor has
       * been folded already. Asking where a file sits rather than counting how
       * many came before it is what makes the fold idempotent: a page redelivered
       * after a crash, an offset that shifted because an activity was uploaded
       * between two passes, a checkpoint whose progress write was lost — each of
       * them re-presents files this build has seen, and each is a no-op instead
       * of a second `+1` on every edge those files touch. Counting could not tell
       * any of them apart, and an inflated count is invisible forever after.
       *
       * It guards the DOUBLE-fold direction only, and can do nothing about the
       * other one, because the scan is still the legacy `LIMIT/OFFSET` paging:
       * an activity DELETED from the part already scanned shifts every later
       * row up one offset, so the file at the resumed offset is not the one
       * after the cursor and the file between them is never presented to this
       * gate at all. That hole is inherited — the legacy blob skips the same
       * activity in the same run — and it heals on the next full generate,
       * which scans from offset 0 under a fresh version and sweeps. Closing it
       * properly means resuming on the build's own keyset cursor rather than
       * the region row's integer offset, which is what retires the legacy
       * paging.
       */
      const isUnfoldedByPyramid = (file: { createdAt: number; id: string }) => {
        const cursor = pyramidBuild?.cursor
        if (!cursor) return true
        if (file.createdAt !== cursor.createdAt) {
          return file.createdAt < cursor.createdAt
        }
        return file.id < cursor.id
      }

      /**
       * Moves the build past a file it has finished with.
       *
       * Called immediately after the fold, BEFORE the flushes that can fire
       * inside the same activity — a flush writes its tiles and the cursor
       * describing them in one statement, so a cursor still naming the previous
       * file would commit this activity's tiles as if they were not there, and
       * the resume that read it back would fold the activity a second time.
       * Called again at the end of the block for files that folded nothing;
       * the guard makes that a no-op for anything already passed.
       */
      const advancePyramidPast = (file: { createdAt: number; id: string }) => {
        if (!pyramidBuild || !isUnfoldedByPyramid(file)) return
        pyramidBuild.cursor = { createdAt: file.createdAt, id: file.id }
        pyramidScannedCount += 1
      }

      const foldActivityIntoPyramid = (
        privacySegments: Array<PrivacySegment<RouteHeatmapPoint>>
      ) => {
        if (!pyramidBuild) return

        // Pre-region on purpose: a tile is region-independent, and clipping
        // happens when it is served.
        const deltas: Map<string, TileDelta> = buildTileDeltasForActivity({
          segments: privacySegments,
          toleranceFloorMeters: routeHeatmapConfig.simplifyToleranceMeters
        })

        for (const [key, delta] of deltas) {
          const pending = pendingTiles.get(key)
          if (!pending) {
            pendingTiles.set(key, delta.edges)
            continue
          }
          for (const [edgeId, edge] of delta.edges) {
            const existingEdge = pending.get(edgeId)
            if (existingEdge) existingEdge.count += edge.count
            else pending.set(edgeId, { ...edge })
          }
        }
      }

      /**
       * Writes the pending tiles and advances the pyramid's own progress.
       *
       * Both land in ONE guarded transaction, which is the correctness argument
       * — ordering them was not enough, because any order leaves a window where
       * one is on disk and the other is not, and a resume that lands there
       * folds activities the tiles already hold. The region checkpoint follows
       * (by the caller), so the pyramid ends up at or ahead of the region
       * cursor and never behind it.
       */
      const flushPendingTiles = async () => {
        if (!pyramidBuild) return
        // Nothing folded and nothing scanned since the last flush: there is no
        // progress to record and the heartbeat is not owed one either.
        if (
          pendingTiles.size === 0 &&
          pyramidScannedCount === flushedScannedCount
        ) {
          return
        }

        const build = pyramidBuild
        try {
          const keys = [...pendingTiles.keys()]
          const stored =
            keys.length === 0
              ? []
              : await database.getFitnessRouteHeatmapTilesByKeys({
                  actorId,
                  tileKeys: keys
                })
          const storedByKey = new Map(stored.map((row) => [row.tileKey, row]))

          const tiles = keys.flatMap((tileKey) => {
            const coordinate = parseTileKey(tileKey)
            const delta = pendingTiles.get(tileKey)
            if (!coordinate || !delta) return []

            const existing = storedByKey.get(tileKey)
            const segments = mergeTileDelta({
              existingSegments: existing ? decodeTile(existing.segments) : [],
              existingVersion: existing?.version ?? -1,
              buildVersion: build.version,
              delta
            })

            return [
              {
                tileKey,
                z: coordinate.z,
                x: coordinate.x,
                y: coordinate.y,
                segments: encodeTile(segments),
                pointCount: countTilePoints(segments)
              }
            ]
          })

          // Tiles and the progress that describes them in ONE guarded
          // statement. Splitting them left a window where the tiles were on
          // disk and the cursor still pointed before them, and a resume landing
          // there folded the same activities again — the counts that come out
          // of that are wrong rather than missing, and nothing downstream can
          // tell. The same statement is the fence and the heartbeat, so it also
          // returns false when the build has been taken over, and flushing is
          // what keeps a working pass from being reclaimed as stale.
          const owned = await database.upsertFitnessRouteHeatmapTiles({
            actorId,
            pyramidId: build.pyramidId,
            claimSeq: build.claimSeq,
            version: build.version,
            tiles,
            progress: {
              scannedCount: pyramidScannedCount,
              activityCount: pyramidActivityCount,
              totalCount,
              ...(build.cursor ? { cursor: build.cursor } : {})
            }
          })
          pendingTiles.clear()

          if (!owned) {
            logger.info({
              message: 'Route heatmap tile build was taken over; leaving it',
              actorId
            })
            pyramidBuild = null
            return
          }

          flushedScannedCount = pyramidScannedCount
        } catch (flushError) {
          // The pyramid is a second, invisible output of this run. Losing it
          // costs a rebuild; failing the run costs the user the heatmap they
          // can actually see, which this pass has otherwise built correctly.
          logger.error({
            message: 'Failed to flush route heatmap tiles; leaving the build',
            actorId,
            err: toLoggableError(flushError)
          })
          pendingTiles.clear()
          pyramidBuild = null
          await releasePyramidBuild(
            build,
            'Failed to flush route heatmap tiles'
          )
        }
      }

      const checkpointAndContinue = async (nextCursorOffset: number) => {
        // Tiles before the region row, so a crash between the two leaves the
        // pyramid at or ahead of the region cursor and never behind it. Being
        // ahead is the harmless direction: the build's own cursor already names
        // the last file it took, so the pages the region row hands back a
        // second time are recognised and skipped.
        //
        // Whatever is still held here is safe to hand to the continuation
        // below: the checkpoint is only reached after a file has been through
        // the per-file block, and that block's `finally` advances the cursor
        // for every file it finished with. A build with no cursor cannot be
        // resumed — the claim reports `resumed` only for one that has it — so
        // a token published from a cursorless build would be presented, told
        // it is not that build's successor, and, arriving at a non-zero
        // offset, release the build it was sent to finish.
        await flushPendingTiles()

        const payload = buildRouteHeatmapPayload({
          privacySegments: allSegments,
          // Checkpoints are resume state, not final render payloads. Preserve
          // the larger accumulation cap here so later continuations do not
          // repeatedly apply the final browser-render cap.
          maxPoints: routeHeatmapConfig.accumulationPointLimit
        })

        const checkpointed = await database.updateFitnessRouteHeatmapStatus({
          id: routeHeatmapId,
          status: 'generating',
          bounds: payload.bounds,
          segments: payload.segments,
          activityCount,
          pointCount: payload.pointCount,
          totalCount,
          cursorOffset: nextCursorOffset,
          isPartial: false,
          error: null,
          abortIfCancelled: true
        })

        // The user cancelled while this pass was running: stop the chain here
        // (leave the row cancelled, publish no continuation) instead of reviving
        // it.
        if (!checkpointed) {
          logger.info({
            message: 'Fitness route heatmap generation cancelled; stopping',
            actorId,
            periodType,
            periodKey,
            cursorOffset: nextCursorOffset
          })
          // No continuation is coming, so hand the build back. Returning while
          // still holding it leaves a `generating` row with a fresh heartbeat
          // and nobody writing to it, which refuses every other claimant until
          // the staleness window lapses.
          if (pyramidBuild) {
            const abandoned = pyramidBuild
            pyramidBuild = null
            await releasePyramidBuild(
              abandoned,
              'Generation was cancelled before the build finished',
              'cancelled'
            )
          }
          return
        }

        const continuationId = getHashFromString(
          `${message.id}:route-heatmap-continuation:${routeHeatmapId}:${nextCursorOffset}`
        )

        await publishJobWithRetry({
          id: continuationId,
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: {
            actorId,
            activityType,
            periodType,
            periodKey,
            ...(normalizedRegion ? { region: normalizedRegion } : {}),
            resume: true,
            cursorOffset: nextCursorOffset,
            maxCursorOffset: maxCursorOffsetForRun,
            ...(requestedAt !== undefined ? { requestedAt } : {}),
            ...(pyramidBuild
              ? {
                  pyramidClaimSeq: pyramidBuild.claimSeq,
                  pyramidBuildId: pyramidBuild.pyramidId
                }
              : {})
          }
        })

        logger.info({
          message: 'Fitness route heatmap cache checkpointed for continuation',
          actorId,
          periodType,
          periodKey,
          cursorOffset: nextCursorOffset,
          activityCount,
          pointCount: payload.pointCount
        })
      }

      while (cursorOffset < maxCursorOffsetForRun) {
        const page = await database.getFitnessFilesByActor({
          ...queryFilters,
          limit: ROUTE_HEATMAP_PAGE_SIZE,
          offset: cursorOffset
        })

        if (page.length === 0) {
          break
        }

        let cachedRoutes = new Map<string, FitnessFileRoute>()

        for (let pageIndex = 0; pageIndex < page.length; pageIndex += 1) {
          const file = page[pageIndex]
          const nextCursorOffset = cursorOffset + pageIndex + 1

          // Read the cached routes a few at a time rather than a page at a
          // time. Batching at all is what turns a fully-cached history from one
          // object-storage round trip per activity into a handful of indexed
          // primary-key lookups; batching the WHOLE page is what would undo
          // it. Every row here is a decoded polyline held until the batch is
          // done, and `filePointLimit` caps a single one at 80,000 points, so
          // 100 dense activities read up front is on the order of 400 MB —
          // past the job's own 512 MB reduce threshold, on the same activities
          // that used to complete when the job held one parse at a time.
          //
          // `shouldReduceAccumulation` cannot rescue that: it downsamples the
          // accumulated segments, a different object, so it would fire on every
          // remaining file and free nothing. And the failure would not heal —
          // the checkpoint cursor points back at the same page, so every retry
          // would rebuild the same batch and die again.
          //
          // The batch size is what bounds the peak and is pinned by test; the
          // `delete` below only lowers the average within a batch.
          if (pageIndex % ROUTE_CACHE_PREFETCH_SIZE === 0) {
            const prefetchIds = page
              .slice(pageIndex, pageIndex + ROUTE_CACHE_PREFETCH_SIZE)
              .map((prefetchFile) => prefetchFile.id)
            cachedRoutes = new Map(
              (
                await database.getFitnessFileRoutes({
                  fitnessFileIds: prefetchIds
                })
              ).map((route) => [route.fitnessFileId, route])
            )
          }

          try {
            if (isParseableFitnessFileType(file.fileType)) {
              const routeCoordinates = await resolveRouteCoordinates(database, {
                actorId,
                fitnessFileId: file.id,
                fileType: file.fileType,
                cachedRoute: cachedRoutes.get(file.id)
              })
              // Folded in below; drop the prefetched copy so it is collectable
              // now rather than at the end of the batch.
              cachedRoutes.delete(file.id)

              // Downsample before privacy/region splitting to keep route-cache
              // generation inside the worker's 30s/1GB budget. This heatmap is
              // an approximate aggregate; exact route rendering still uses the
              // original per-file route-data endpoint.
              if (routeCoordinates.length >= 2) {
                const privacyAwarePoints = annotatePointsWithPrivacy(
                  routeCoordinates,
                  privacyLocations
                )
                const privacySegments = buildPrivacySegments(privacyAwarePoints)

                // Before the region filter: the pyramid stores tiles
                // unclipped, and a region is applied when they are served.
                if (pyramidBuild && isUnfoldedByPyramid(file)) {
                  // Contained like every other piece of tile work. The fold is
                  // pure, but it runs inside the per-file try that the legacy
                  // accumulation below shares, so an exception out of the tiler
                  // would drop this activity from the user-visible heatmap too
                  // — the one output of this run that anybody can currently
                  // see.
                  try {
                    foldActivityIntoPyramid(privacySegments)
                    pyramidActivityCount += 1
                    // Before the flushes below, never after them.
                    advancePyramidPast(file)
                  } catch (foldError) {
                    logger.error({
                      message:
                        'Failed to fold an activity into the route heatmap pyramid; leaving the build',
                      actorId,
                      fitnessFileId: file.id,
                      err: toLoggableError(foldError)
                    })
                    const abandoned = pyramidBuild
                    pyramidBuild = null
                    pendingTiles.clear()
                    await releasePyramidBuild(
                      abandoned,
                      'Failed to fold an activity into the route heatmap pyramid'
                    )
                  }
                }

                const filteredSegments = applyRegionFilter(
                  privacySegments,
                  regionBounds
                )
                const filteredPointCount = countSegmentPoints(filteredSegments)
                const boundedSegments =
                  filteredPointCount > routeHeatmapConfig.accumulationPointLimit
                    ? downsampleSegmentsForCache(
                        filteredSegments,
                        routeHeatmapConfig.accumulationPointLimit
                      )
                    : filteredSegments

                if (boundedSegments.length > 0) {
                  activityCount += 1
                  allSegments.push(...boundedSegments)
                  allSegmentPointCount += countSegmentPoints(boundedSegments)
                }

                // Bound the delta map between checkpoints: a build sweeping a
                // dense city touches tiles far faster than 20s of wall clock.
                if (pendingTiles.size >= TILE_FLUSH_PENDING_LIMIT) {
                  await flushPendingTiles()
                }

                if (
                  shouldReduceAccumulation(
                    allSegmentPointCount,
                    routeHeatmapConfig
                  )
                ) {
                  // The heap guard fires for the whole run, not just the
                  // accumulated segments, so hand back the tile edges too.
                  await flushPendingTiles()
                  // This is a memory guard, not a statistically uniform sampler.
                  // It keeps the QStash worker well below a 1 GB container budget;
                  // the final/checkpoint payload remains capped for browser rendering.
                  allSegments = downsampleSegmentsForCache(allSegments)
                  allSegmentPointCount = countSegmentPoints(allSegments)
                }
              }
            }
          } catch (error) {
            logger.warn({
              message:
                'Failed to parse fitness file for route heatmap; skipping',
              actorId,
              fitnessFileId: file.id,
              err: toLoggableError(error)
            })
          } finally {
            // Every file this pass is finished with moves the build's cursor —
            // one that folded geometry, one that held none, and one that could
            // not be read at all. A `finally` rather than the end of the `try`
            // for that last case: a file whose download or parse throws is
            // still a file this build has dealt with, and leaving the cursor
            // short of it is what the claim reads as a build that never
            // reached an activity.
            //
            // That is not merely untidy. The claim only reports `resumed` for
            // a build that HAS a cursor, so a first pass whose every file threw
            // — a storage outage, which is also how the time budget gets
            // consumed — would hand its own continuation a token the claim then
            // refuses, and the coverage guard below would release the build.
            // Every later pass in the chain carries a non-zero offset and can
            // start nothing either, so the actor's pyramid never gets built.
            //
            // A file that folded geometry was already passed above; the
            // `isUnfoldedByPyramid` guard inside makes this a no-op for it.
            advancePyramidPast(file)
          }

          const isLastKnownFile =
            page.length < ROUTE_HEATMAP_PAGE_SIZE &&
            pageIndex === page.length - 1
          const canContinue = nextCursorOffset < maxCursorOffsetForRun

          if (canContinue && !isLastKnownFile && shouldCheckpoint(startedAt)) {
            await checkpointAndContinue(nextCursorOffset)
            return
          }
        }

        cursorOffset += page.length

        if (page.length < ROUTE_HEATMAP_PAGE_SIZE) {
          break
        }

        if (cursorOffset >= maxCursorOffsetForRun) {
          reachedPageLimit = true
          break
        }
      }

      if (reachedPageLimit) {
        logger.warn({
          message:
            'Route heatmap generation reached the fitness file page limit',
          actorId,
          periodType,
          periodKey,
          pageSize: ROUTE_HEATMAP_PAGE_SIZE,
          maxFiles: ROUTE_HEATMAP_MAX_FILES
        })
      }

      // Everything folded since the last checkpoint.
      await flushPendingTiles()

      // A run that stopped at the file page limit has not seen the whole
      // history, so its tiles are not a complete pyramid: completing here would
      // sweep the previous version's tiles out from under a partial one. It
      // publishes no continuation either, so no later pass can hold this
      // build's token — hand it back rather than leaving a `generating` row
      // with a fresh heartbeat and nobody writing to it, which refuses every
      // claimant until the staleness window lapses. The next generation starts
      // a fresh version and rebuilds, which is merely wasteful.
      if (pyramidBuild && reachedPageLimit) {
        const stopped = pyramidBuild
        pyramidBuild = null
        await releasePyramidBuild(
          stopped,
          'Run stopped at the fitness file page limit'
        )
      }

      if (pyramidBuild) {
        const build = pyramidBuild
        let completedTheBuild = false
        try {
          // Claim the finish FIRST, because it is the guarded write: a pass
          // that has been superseded learns so here and stops, instead of
          // sweeping on behalf of a build it no longer owns.
          // Counted from what is actually on disk. A tile touched by several
          // flushes is still one row, and a build spanning continuations has no
          // single process that saw them all.
          const totals = await database.getFitnessRouteHeatmapTileTotals({
            actorId,
            version: build.version
          })

          const finished = await database.updateFitnessRouteHeatmapPyramid({
            actorId,
            pyramidId: build.pyramidId,
            claimSeq: build.claimSeq,
            status: 'completed',
            error: null,
            tileCount: totals.tileCount,
            pointCount: totals.pointCount,
            // The pyramid's own count, not the legacy run's: tiles are stored
            // unclipped, so a run that happened to carry a region filter must
            // not stamp the actor-wide build with a region-clipped total.
            activityCount: pyramidActivityCount,
            totalCount,
            scannedCount: pyramidScannedCount,
            completedAt: Date.now()
          })

          if (!finished) {
            logger.info({
              message:
                'Route heatmap tile build was taken over before it completed',
              actorId
            })
          } else {
            completedTheBuild = true
          }
        } catch (completionError) {
          logger.error({
            message: 'Failed to complete the route heatmap tile build',
            actorId,
            err: toLoggableError(completionError)
          })
          await releasePyramidBuild(
            build,
            'Failed to complete the route heatmap tile build'
          )
        }

        // The sweep is cleanup, NOT part of completing the build, so it gets
        // its own guard. Inside the completion's `try` a sweep that threw
        // rewrote a finished, correct pyramid — right counters, right
        // `completedAt`, tiles on disk — to `failed`, because the release is
        // fenced on a token the completion write does not move. What a failed
        // sweep actually costs is some tiles at an older version, which the
        // next build's own sweep removes.
        if (completedTheBuild) {
          try {
            // Activities deleted since the last build disappear here: their
            // tiles still carry the older version and nothing rewrote them.
            await database.deleteStaleFitnessRouteHeatmapTiles({
              actorId,
              pyramidId: build.pyramidId,
              claimSeq: build.claimSeq,
              beforeVersion: build.version
            })
          } catch (sweepError) {
            logger.error({
              message:
                'Failed to sweep the tiles an earlier route heatmap build left behind',
              actorId,
              err: toLoggableError(sweepError)
            })
          }
        }

        pyramidBuild = null
      }

      // Final stored payload: simplify (not just cap) so the persisted geometry
      // keeps its road-following shape. Checkpoint payloads above deliberately
      // skip this — they are resume state that must retain raw points.
      const payload = buildRouteHeatmapPayload({
        privacySegments: allSegments,
        simplifyToleranceMeters: routeHeatmapConfig.simplifyToleranceMeters
      })

      const completed = await database.updateFitnessRouteHeatmapStatus({
        id: routeHeatmapId,
        status: 'completed',
        bounds: payload.bounds,
        segments: payload.segments,
        activityCount,
        pointCount: payload.pointCount,
        totalCount,
        cursorOffset: reachedPageLimit ? cursorOffset : 0,
        isPartial: reachedPageLimit,
        error: null,
        abortIfCancelled: true
      })

      // The user cancelled before this pass finished: keep the row cancelled
      // rather than marking it completed.
      if (!completed) {
        logger.info({
          message:
            'Fitness route heatmap generation cancelled before completion',
          actorId,
          periodType,
          periodKey
        })
        return
      }

      logger.info({
        message: 'Fitness route heatmap cache generated successfully',
        actorId,
        periodType,
        periodKey,
        activityCount,
        pointCount: payload.pointCount
      })
    } catch (error) {
      const nodeError = error as Error
      logger.error({
        message: 'Failed to generate fitness route heatmap cache',
        actorId,
        periodType,
        periodKey,
        // Both: `error` is the string persisted on the row below, `err` is what
        // the formatter reads `stack` off to emit `stack_trace`.
        error: nodeError.message,
        err: toLoggableError(error)
      })

      // Best-effort, and deliberately before the region row: a build left
      // `generating` would block every later claim until its heartbeat went
      // stale. A failure here must never mask the original error, which is
      // rethrown below whatever happens.
      if (pyramidBuild) {
        try {
          await database.updateFitnessRouteHeatmapPyramid({
            actorId,
            pyramidId: pyramidBuild.pyramidId,
            claimSeq: pyramidBuild.claimSeq,
            status: 'failed',
            error: nodeError.message
          })
        } catch (pyramidError) {
          logger.error({
            message: 'Failed to mark the route heatmap pyramid as failed',
            actorId,
            err: toLoggableError(pyramidError)
          })
        }
      }

      if (heatmapId) {
        try {
          // Don't overwrite a user cancellation that landed mid-run with a
          // failure status.
          await database.updateFitnessRouteHeatmapStatus({
            id: heatmapId,
            status: 'failed',
            error: nodeError.message,
            abortIfCancelled: true
          })
        } catch (statusError) {
          logger.error({
            message: 'Failed to mark route heatmap cache as failed',
            actorId,
            periodType,
            periodKey,
            err: toLoggableError(statusError)
          })
        }
      }

      throw nodeError
    } finally {
      // The carried build is released on EVERY exit, not at each guard that
      // drops a continuation. Four separate guards do that, and a per-guard
      // release was missed on one of them twice — and none of them covers a
      // throw between the token being read and the claim being made, which
      // strands the build just as thoroughly.
      //
      // Unconditional because it is fenced on the CARRIED token, and every
      // claim moves the token: once this pass adopted the build, or anyone else
      // took it over, or it was completed, this matches no row and writes
      // nothing. It only ever fires for a build that is still sitting where its
      // predecessor left it with nobody coming back for it.
      if (carriedPyramidBuild) {
        await releasePyramidBuild(carriedPyramidBuild, carriedBuildDropReason)
      }
    }
  }
)

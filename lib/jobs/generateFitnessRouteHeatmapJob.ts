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
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { createJobHandle } from './createJobHandle'

// Each generation pass must finish (and checkpoint) well inside the queue's
// per-job timeout. QStash caps a job at 30s (MAX_JOB_TIMEOUT_SECONDS); we stop
// accumulating at 20s and spend the remaining headroom persisting the
// checkpoint payload and publishing the continuation, keeping wall-clock under
// the ~25s-per-task target. Anything longer is split into a continuation job.
const ROUTE_HEATMAP_JOB_TIME_BUDGET_MS = 20_000
const ROUTE_HEATMAP_PAGE_SIZE = 100
// How many cached routes to read ahead within a page. Ten keeps the worst-case
// live set (10 x `filePointLimit` = 800,000 points, ~40 MB of tuples) at the
// same order as the single raw parse this job held before the cache existed,
// while still collapsing a page's storage reads into ten indexed lookups.
export const ROUTE_CACHE_PREFETCH_SIZE = 10
const ROUTE_HEATMAP_MAX_FILES = 1_000_000
const QUEUE_PUBLISH_MAX_ATTEMPTS = 3

const JobData = z.object({
  actorId: z.string(),
  activityType: z.string().nullable(),
  periodType: z.enum(['all_time', 'yearly', 'monthly']),
  periodKey: z.string(),
  region: z.string().nullable().optional(),
  resume: z.boolean().optional(),
  cursorOffset: z.number().int().nonnegative().optional(),
  maxCursorOffset: z.number().int().positive().optional(),
  requestedAt: z.number().int().nonnegative().optional()
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
      requestedAt
    } = JobData.parse(message.data)

    const startedAt = Date.now()
    const routeHeatmapConfig = getFitnessRouteHeatmapConfig()
    const normalizedRegion = region?.trim() || ''
    const regionBounds = getRegionBounds(deserializeRegions(normalizedRegion))
    const { periodStart, periodEnd } = getPeriodRange(periodType, periodKey)

    let heatmapId: string | undefined

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

      const isResume = resume === true
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

      const checkpointAndContinue = async (nextCursorOffset: number) => {
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
            ...(requestedAt !== undefined ? { requestedAt } : {})
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

                if (
                  shouldReduceAccumulation(
                    allSegmentPointCount,
                    routeHeatmapConfig
                  )
                ) {
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
        error: nodeError.message
      })

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
            error: (statusError as Error).message
          })
        }
      }

      throw nodeError
    }
  }
)

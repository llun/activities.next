import { z } from 'zod'

import { Database } from '@/lib/database/types'
import {
  type RegionBounds,
  deserializeRegions,
  getRegionBounds
} from '@/lib/fitness/regions'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
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
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'

const ACCUMULATION_DOWNSAMPLE_POINT_LIMIT =
  DEFAULT_ROUTE_HEATMAP_MAX_POINTS * 10

const JobData = z.object({
  actorId: z.string(),
  activityType: z.string().nullable(),
  periodType: z.enum(['all_time', 'yearly', 'monthly']),
  periodKey: z.string(),
  region: z.string().nullable().optional()
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

export const generateFitnessRouteHeatmapJob = createJobHandle(
  GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
  async (database, message) => {
    const { actorId, activityType, periodType, periodKey, region } =
      JobData.parse(message.data)

    const normalizedRegion = region?.trim() || ''
    const regionBounds =
      normalizedRegion !== ''
        ? getRegionBounds(deserializeRegions(normalizedRegion))
        : []
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

      if (existing) {
        heatmapId = existing.id
        await database.updateFitnessRouteHeatmapStatus({
          id: existing.id,
          status: 'generating',
          error: null,
          clearDeleted: true
        })
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
          error: null
        })
      }

      const privacySettings = await database.getFitnessSettings({
        actorId,
        serviceType: 'general'
      })
      const privacyLocations = getFitnessPrivacyLocations(privacySettings)

      const PAGE_SIZE = 1_000
      const MAX_PAGES = 1_000
      let offset = 0
      let reachedPageLimit = false

      const queryFilters = {
        actorId,
        processingStatus: 'completed' as const,
        isPrimary: true,
        ...(activityType !== null ? { activityType } : {}),
        ...(periodType !== 'all_time'
          ? { startDate: periodStart, endDate: periodEnd }
          : {})
      }

      let allSegments: Array<PrivacySegment<RouteHeatmapPoint>> = []
      let allSegmentPointCount = 0
      let activityCount = 0

      for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
        const page = await database.getFitnessFilesByActor({
          ...queryFilters,
          limit: PAGE_SIZE,
          offset
        })

        for (const file of page) {
          try {
            if (!isParseableFitnessFileType(file.fileType)) continue

            const buffer = await getFitnessFileBuffer(database, file.id)
            const activityData = await parseFitnessFile({
              fileType: file.fileType,
              buffer
            })

            if (activityData.coordinates.length < 2) {
              continue
            }

            const privacyAwarePoints = annotatePointsWithPrivacy(
              activityData.coordinates,
              privacyLocations
            )
            const privacySegments = buildPrivacySegments(privacyAwarePoints)
            const filteredSegments = applyRegionFilter(
              privacySegments,
              regionBounds
            )

            if (filteredSegments.length > 0) {
              activityCount += 1
              allSegments.push(...filteredSegments)
              allSegmentPointCount += countSegmentPoints(filteredSegments)
            }

            if (allSegmentPointCount > ACCUMULATION_DOWNSAMPLE_POINT_LIMIT) {
              // This is a memory guard, not a statistically uniform sampler.
              // It prefers bounded worker memory over perfect corpus-wide sampling;
              // the final payload is downsampled again to DEFAULT_ROUTE_HEATMAP_MAX_POINTS.
              allSegments = downsamplePrivacySegments(
                allSegments,
                DEFAULT_ROUTE_HEATMAP_MAX_POINTS,
                {
                  minimumPointsPerSegment: 2
                }
              ).filter((segment) => segment.points.length >= 2)
              allSegmentPointCount = countSegmentPoints(allSegments)
            }
          } catch (error) {
            const nodeError = error as Error
            logger.warn({
              message:
                'Failed to parse fitness file for route heatmap; skipping',
              actorId,
              fitnessFileId: file.id,
              error: nodeError.message
            })
          }
        }

        if (page.length < PAGE_SIZE) {
          break
        }

        if (pageNum === MAX_PAGES - 1) {
          reachedPageLimit = true
          break
        }

        offset += PAGE_SIZE
      }

      if (reachedPageLimit) {
        logger.warn({
          message:
            'Route heatmap generation reached the fitness file page limit',
          actorId,
          periodType,
          periodKey,
          pageSize: PAGE_SIZE,
          maxPages: MAX_PAGES
        })
      }

      const payload = buildRouteHeatmapPayload({
        privacySegments: allSegments
      })

      await database.updateFitnessRouteHeatmapStatus({
        id: heatmapId,
        status: 'completed',
        bounds: payload.bounds,
        segments: payload.segments,
        activityCount,
        pointCount: payload.pointCount,
        error: null
      })

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
          await database.updateFitnessRouteHeatmapStatus({
            id: heatmapId,
            status: 'failed',
            error: nodeError.message
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

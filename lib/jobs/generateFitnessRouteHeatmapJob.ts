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
  getFitnessPrivacyLocations
} from '@/lib/services/fitness-files/privacy'
import type { PrivacySegment } from '@/lib/services/fitness-files/privacy'
import {
  buildRouteHeatmapPayload,
  splitSegmentByBounds
} from '@/lib/services/fitness-files/routeHeatmap'
import type { RouteHeatmapPoint } from '@/lib/services/fitness-files/routeHeatmap'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'

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

      const PAGE_SIZE = 10_000
      const MAX_PAGES = 100
      const matchingFiles: Awaited<
        ReturnType<typeof database.getFitnessFilesByActor>
      > = []
      let offset = 0

      const queryFilters = {
        actorId,
        processingStatus: 'completed' as const,
        isPrimary: true,
        ...(activityType !== null ? { activityType } : {}),
        ...(periodType !== 'all_time'
          ? { startDate: periodStart, endDate: periodEnd }
          : {})
      }

      for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
        const page = await database.getFitnessFilesByActor({
          ...queryFilters,
          limit: PAGE_SIZE,
          offset
        })
        matchingFiles.push(...page)
        if (page.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      const allSegments: Array<PrivacySegment<RouteHeatmapPoint>> = []
      let activityCount = 0

      for (const file of matchingFiles) {
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
          }
        } catch (error) {
          const nodeError = error as Error
          logger.warn({
            message: 'Failed to parse fitness file for route heatmap; skipping',
            actorId,
            fitnessFileId: file.id,
            error: nodeError.message
          })
        }
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
        await database.updateFitnessRouteHeatmapStatus({
          id: heatmapId,
          status: 'failed',
          error: nodeError.message
        })
      }
    }
  }
)

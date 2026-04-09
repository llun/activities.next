import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { deserializeRegions, getRegionBounds } from '@/lib/fitness/regions'
import { GENERATE_FITNESS_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { generateHeatmapImage } from '@/lib/services/fitness-files/generateHeatmapImage'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import type { FitnessCoordinate } from '@/lib/services/fitness-files/parseFitnessFile'
import { deleteMediaFile, saveMedia } from '@/lib/services/medias'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'

const JobData = z.object({
  actorId: z.string(),
  activityType: z.string().nullable(),
  periodType: z.enum(['all_time', 'yearly', 'monthly']),
  periodKey: z.string(),
  /** Serialized sorted region IDs, e.g. "netherlands,singapore". Null = world-wide. */
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

export const generateFitnessHeatmapJob = createJobHandle(
  GENERATE_FITNESS_HEATMAP_JOB_NAME,
  async (database, message) => {
    const { actorId, activityType, periodType, periodKey, region } =
      JobData.parse(message.data)

    // '' = world-wide; non-empty = serialized region IDs.
    // Trim + falsy-coerce to prevent empty-string bleed through.
    const normalizedRegion = region?.trim() || ''
    const regionBounds =
      normalizedRegion !== ''
        ? getRegionBounds(deserializeRegions(normalizedRegion))
        : []

    const { periodStart, periodEnd } = getPeriodRange(periodType, periodKey)

    let heatmapId: string | undefined
    let previousImagePath: string | undefined

    try {
      const actor = await database.getActorFromId({ id: actorId })
      if (!actor) {
        throw new Error('Actor not found')
      }

      const existing = await database.getFitnessHeatmapByKey({
        actorId,
        activityType,
        periodType,
        periodKey,
        region: normalizedRegion,
        includeDeleted: true
      })

      if (existing) {
        heatmapId = existing.id
        previousImagePath = existing.imagePath
        await database.updateFitnessHeatmapStatus({
          id: existing.id,
          status: 'generating',
          clearDeleted: true
        })
      } else {
        const created = await database.createFitnessHeatmap({
          actorId,
          activityType,
          periodType,
          periodKey,
          region: normalizedRegion,
          periodStart,
          periodEnd
        })
        heatmapId = created.id
        await database.updateFitnessHeatmapStatus({
          id: created.id,
          status: 'generating'
        })
      }

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

      const allRouteSegments: FitnessCoordinate[][] = []

      for (const file of matchingFiles) {
        try {
          if (!isParseableFitnessFileType(file.fileType)) continue

          const buffer = await getFitnessFileBuffer(database, file.id)
          const activityData = await parseFitnessFile({
            fileType: file.fileType,
            buffer
          })

          if (activityData.coordinates.length >= 2) {
            allRouteSegments.push(activityData.coordinates)
          }
        } catch (error) {
          const nodeError = error as Error
          logger.warn({
            message: 'Failed to parse fitness file for heatmap; skipping',
            actorId,
            fitnessFileId: file.id,
            error: nodeError.message
          })
        }
      }

      if (allRouteSegments.length === 0) {
        await database.updateFitnessHeatmapStatus({
          id: heatmapId,
          status: 'completed',
          activityCount: 0,
          imagePath: null
        })

        if (previousImagePath) {
          await deleteMediaFile(database, previousImagePath).catch((err) => {
            logger.warn({
              message: 'Failed to delete previous heatmap image',
              previousImagePath,
              error: (err as Error).message
            })
          })
        }

        logger.info({
          message: 'No route data found for heatmap; marked completed',
          actorId,
          periodType,
          periodKey
        })
        return
      }

      const imageBuffer = await generateHeatmapImage({
        routeSegments: allRouteSegments,
        regionBounds: regionBounds.length > 0 ? regionBounds : undefined
      })

      if (!imageBuffer) {
        await database.updateFitnessHeatmapStatus({
          id: heatmapId,
          status: 'completed',
          activityCount: allRouteSegments.length,
          imagePath: null
        })

        if (previousImagePath) {
          await deleteMediaFile(database, previousImagePath).catch((err) => {
            logger.warn({
              message: 'Failed to delete previous heatmap image',
              previousImagePath,
              error: (err as Error).message
            })
          })
        }
        return
      }

      const imageBytes = new Uint8Array(imageBuffer)
      // Use the heatmap ID in the filename to avoid exceeding filesystem path
      // limits when multiple regions are selected (PR #556).
      const safeHeatmapId = heatmapId ?? 'unknown'
      const fileName = `heatmap-${safeHeatmapId}.png`

      const activityLabel = activityType ?? 'all'
      const storedMedia = await saveMedia(database, actor, {
        file: new File([imageBytes], fileName, { type: 'image/png' }),
        description: `Fitness heatmap: ${activityLabel} ${periodType} ${periodKey}`
      })

      if (!storedMedia) {
        throw new Error('Failed to save heatmap image to media storage')
      }

      const imagePath = getAttachmentMediaPath(storedMedia.url)

      await database.updateFitnessHeatmapStatus({
        id: heatmapId,
        status: 'completed',
        imagePath,
        activityCount: allRouteSegments.length
      })

      // Clean up previous heatmap image to avoid orphaned files
      if (previousImagePath && previousImagePath !== imagePath) {
        await deleteMediaFile(database, previousImagePath).catch((err) => {
          logger.warn({
            message: 'Failed to delete previous heatmap image',
            previousImagePath,
            error: (err as Error).message
          })
        })
      }

      logger.info({
        message: 'Fitness heatmap generated successfully',
        actorId,
        periodType,
        periodKey,
        activityCount: allRouteSegments.length
      })
    } catch (error) {
      const nodeError = error as Error
      logger.error({
        message: 'Failed to generate fitness heatmap',
        actorId,
        periodType,
        periodKey,
        error: nodeError.message
      })

      if (heatmapId) {
        await database.updateFitnessHeatmapStatus({
          id: heatmapId,
          status: 'failed',
          error: nodeError.message
        })
      }
    }
  }
)

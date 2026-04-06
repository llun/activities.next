import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { GENERATE_FITNESS_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { generateHeatmapImage } from '@/lib/services/fitness-files/generateHeatmapImage'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import type { FitnessCoordinate } from '@/lib/services/fitness-files/parseFitnessFile'
import { saveMedia } from '@/lib/services/medias'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'

const JobData = z.object({
  actorId: z.string(),
  activityType: z.string().nullable(),
  periodType: z.enum(['all_time', 'yearly', 'monthly']),
  periodKey: z.string()
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
    const { actorId, activityType, periodType, periodKey } = JobData.parse(
      message.data
    )

    const { periodStart, periodEnd } = getPeriodRange(periodType, periodKey)

    let heatmapId: string | undefined

    try {
      const actor = await database.getActorFromId({ id: actorId })
      if (!actor) {
        throw new Error('Actor not found')
      }

      const existing = await database.getFitnessHeatmapByKey({
        actorId,
        activityType,
        periodType,
        periodKey
      })

      if (existing) {
        heatmapId = existing.id
        await database.updateFitnessHeatmapStatus({
          id: existing.id,
          status: 'generating'
        })
      } else {
        const created = await database.createFitnessHeatmap({
          actorId,
          activityType,
          periodType,
          periodKey,
          periodStart,
          periodEnd
        })
        heatmapId = created.id
        await database.updateFitnessHeatmapStatus({
          id: created.id,
          status: 'generating'
        })
      }

      const allFiles = await database.getFitnessFilesByActor({
        actorId,
        limit: 10_000,
        offset: 0
      })

      const matchingFiles = allFiles.filter((file) => {
        if (file.processingStatus !== 'completed') return false
        if (!file.isPrimary) return false
        if (file.deletedAt) return false

        if (file.activityStartTime) {
          const startTime = file.activityStartTime
          if (
            startTime < periodStart.getTime() ||
            startTime > periodEnd.getTime()
          ) {
            return false
          }
        }

        if (activityType !== null && file.activityType !== activityType) {
          return false
        }

        return true
      })

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

        logger.info({
          message: 'No route data found for heatmap; marked completed',
          actorId,
          periodType,
          periodKey
        })
        return
      }

      const imageBuffer = await generateHeatmapImage({
        routeSegments: allRouteSegments
      })

      if (!imageBuffer) {
        await database.updateFitnessHeatmapStatus({
          id: heatmapId,
          status: 'completed',
          activityCount: allRouteSegments.length,
          imagePath: null
        })
        return
      }

      const imageBytes = new Uint8Array(imageBuffer)
      const activityTypePath = activityType ?? 'all'
      const fileName = `heatmap-${activityTypePath}-${periodType}_${periodKey}.png`

      const storedMedia = await saveMedia(database, actor, {
        file: new File([imageBytes], fileName, { type: 'image/png' }),
        description: `Fitness heatmap: ${activityTypePath} ${periodType} ${periodKey}`
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

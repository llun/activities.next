import { Database } from '@/lib/database/types'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

interface EnqueueFitnessRouteHeatmapJobsParams {
  database: Database
  actorId: string
  activityType?: string | null
  activityStartTime?: Date | number | null
}

type RouteHeatmapVariant = {
  activityType: string | null
  periodType: 'all_time' | 'yearly' | 'monthly'
  periodKey: string
  region?: string
}

const toActivityDate = (activityStartTime?: Date | number | null) => {
  if (activityStartTime instanceof Date) {
    return activityStartTime
  }

  if (typeof activityStartTime === 'number') {
    return new Date(activityStartTime)
  }

  return new Date()
}

const buildBaseVariants = (
  activityType: string | null,
  activityDate: Date
): RouteHeatmapVariant[] => {
  const year = activityDate.getUTCFullYear().toString()
  const month = `${year}-${String(activityDate.getUTCMonth() + 1).padStart(2, '0')}`

  const variants: RouteHeatmapVariant[] = [
    {
      activityType: null,
      periodType: 'all_time',
      periodKey: 'all'
    },
    {
      activityType: null,
      periodType: 'yearly',
      periodKey: year
    },
    {
      activityType: null,
      periodType: 'monthly',
      periodKey: month
    }
  ]

  if (activityType) {
    variants.push(
      {
        activityType,
        periodType: 'all_time',
        periodKey: 'all'
      },
      {
        activityType,
        periodType: 'yearly',
        periodKey: year
      },
      {
        activityType,
        periodType: 'monthly',
        periodKey: month
      }
    )
  }

  return variants
}

export const enqueueFitnessRouteHeatmapJobs = async ({
  database,
  actorId,
  activityType = null,
  activityStartTime
}: EnqueueFitnessRouteHeatmapJobsParams) => {
  const activityDate = toActivityDate(activityStartTime)
  const baseVariants = buildBaseVariants(activityType, activityDate)

  const distinctRegions = await database.getDistinctRouteHeatmapRegionsForActor(
    {
      actorId
    }
  )
  // This refresh path intentionally covers the changed file's all-time/year/month
  // buckets plus matching cached region mirrors. A broader stale-cache sweeper
  // should handle historical region/period combinations outside this activity date.
  const regionVariants = distinctRegions.flatMap((region) =>
    baseVariants.map((variant) => ({ ...variant, region }))
  )
  const allVariants = [...baseVariants, ...regionVariants]
  const requestedAt = Date.now()

  const queue = getQueue()
  const results = await Promise.allSettled(
    allVariants.map((variant) => {
      const jobId = getHashFromString(
        actorId +
          ':route-heatmap:' +
          (variant.activityType ?? 'all') +
          ':' +
          variant.periodType +
          ':' +
          variant.periodKey +
          ':' +
          (variant.region ?? '')
      )

      return queue.publish({
        id: jobId,
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId,
          activityType: variant.activityType,
          periodType: variant.periodType,
          periodKey: variant.periodKey,
          requestedAt,
          ...(variant.region ? { region: variant.region } : {})
        }
      })
    })
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn({
        message: 'Failed to publish route heatmap generation job',
        actorId,
        error: (result.reason as Error).message
      })
    }
  }
}

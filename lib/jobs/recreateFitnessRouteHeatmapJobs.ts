import { randomUUID } from 'node:crypto'

import type { Database } from '@/lib/database/types'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import type { Queue } from '@/lib/services/queue/type'
import type { FitnessFile } from '@/lib/types/database/fitnessFile'
import type { FitnessRouteHeatmapPeriodType } from '@/lib/types/database/fitnessRouteHeatmap'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

const FITNESS_FILE_PAGE_SIZE = 500
const ROUTE_HEATMAP_RECREATE_PUBLISH_CONCURRENCY = 4

export interface RecreateFitnessRouteHeatmapVariant {
  activityType: string | null
  periodType: FitnessRouteHeatmapPeriodType
  periodKey: string
  region?: string
}

export type RecreateFitnessRouteHeatmapJobsDatabase = Pick<
  Database,
  | 'getDistinctRouteHeatmapRegionsForActor'
  | 'getFitnessFilesByActor'
  | 'deleteFitnessRouteHeatmapsForActor'
>

export interface RecreateFitnessRouteHeatmapJobsParams {
  database: RecreateFitnessRouteHeatmapJobsDatabase
  actorId: string
  dryRun?: boolean
  runId?: string
}

export interface RecreateFitnessRouteHeatmapJobError {
  variant: RecreateFitnessRouteHeatmapVariant
  error: string
}

export interface RecreateFitnessRouteHeatmapJobsResult {
  variants: RecreateFitnessRouteHeatmapVariant[]
  deletedCount: number
  queuedCount: number
  failedCount: number
  errors: RecreateFitnessRouteHeatmapJobError[]
}

const PeriodTypeOrder: Record<FitnessRouteHeatmapPeriodType, number> = {
  all_time: 0,
  yearly: 1,
  monthly: 2
}

const getVariantKey = ({
  activityType,
  periodType,
  periodKey,
  region
}: RecreateFitnessRouteHeatmapVariant) =>
  `${activityType ?? ''}\u0000${periodType}\u0000${periodKey}\u0000${region ?? ''}`

const sortVariants = (
  left: RecreateFitnessRouteHeatmapVariant,
  right: RecreateFitnessRouteHeatmapVariant
) =>
  (left.region ?? '').localeCompare(right.region ?? '') ||
  (left.activityType ?? '').localeCompare(right.activityType ?? '') ||
  PeriodTypeOrder[left.periodType] - PeriodTypeOrder[right.periodType] ||
  left.periodKey.localeCompare(right.periodKey)

const addVariant = (
  variants: Map<string, RecreateFitnessRouteHeatmapVariant>,
  variant: RecreateFitnessRouteHeatmapVariant
) => {
  variants.set(getVariantKey(variant), variant)
}

const getActivityDate = (file: FitnessFile): Date | null => {
  if (typeof file.activityStartTime !== 'number') {
    return null
  }

  const date = new Date(file.activityStartTime)
  return Number.isNaN(date.getTime()) ? null : date
}

const addFileVariants = (
  variants: Map<string, RecreateFitnessRouteHeatmapVariant>,
  file: FitnessFile
) => {
  const activityType = file.activityType?.trim() || null
  const activityDate = getActivityDate(file)

  addVariant(variants, {
    activityType: null,
    periodType: 'all_time',
    periodKey: 'all'
  })

  if (activityType) {
    addVariant(variants, {
      activityType,
      periodType: 'all_time',
      periodKey: 'all'
    })
  }

  if (!activityDate) {
    // Scoped route-heatmap generation filters by activityStartTime; files
    // without one cannot contribute to yearly/monthly caches.
    return
  }

  const year = activityDate.getUTCFullYear().toString()
  const month = `${year}-${String(activityDate.getUTCMonth() + 1).padStart(2, '0')}`

  addVariant(variants, {
    activityType: null,
    periodType: 'yearly',
    periodKey: year
  })
  addVariant(variants, {
    activityType: null,
    periodType: 'monthly',
    periodKey: month
  })

  if (activityType) {
    addVariant(variants, {
      activityType,
      periodType: 'yearly',
      periodKey: year
    })
    addVariant(variants, {
      activityType,
      periodType: 'monthly',
      periodKey: month
    })
  }
}

const normalizeRegions = (regions: string[]) =>
  Array.from(
    new Set(regions.map((region) => region.trim()).filter(Boolean))
  ).sort()

const buildVariantsFromBaseMap = ({
  baseVariants,
  regions
}: {
  baseVariants: Map<string, RecreateFitnessRouteHeatmapVariant>
  regions: string[]
}): RecreateFitnessRouteHeatmapVariant[] => {
  const variants = new Map(baseVariants)
  const baseVariantValues = Array.from(baseVariants.values())

  for (const region of normalizeRegions(regions)) {
    for (const variant of baseVariantValues) {
      addVariant(variants, { ...variant, region })
    }
  }

  return Array.from(variants.values()).sort(sortVariants)
}

export const buildRecreateFitnessRouteHeatmapVariants = ({
  fitnessFiles,
  regions
}: {
  fitnessFiles: FitnessFile[]
  regions: string[]
}): RecreateFitnessRouteHeatmapVariant[] => {
  const baseVariants = new Map<string, RecreateFitnessRouteHeatmapVariant>()

  for (const file of fitnessFiles) {
    addFileVariants(baseVariants, file)
  }

  return buildVariantsFromBaseMap({ baseVariants, regions })
}

const getCompletedPrimaryFitnessFileVariantsForActor = async (
  database: RecreateFitnessRouteHeatmapJobsDatabase,
  actorId: string
) => {
  const variants = new Map<string, RecreateFitnessRouteHeatmapVariant>()
  let offset = 0

  while (true) {
    const page = await database.getFitnessFilesByActor({
      actorId,
      processingStatus: 'completed',
      isPrimary: true,
      limit: FITNESS_FILE_PAGE_SIZE,
      offset
    })

    for (const file of page) {
      addFileVariants(variants, file)
    }

    if (page.length < FITNESS_FILE_PAGE_SIZE) {
      break
    }

    offset += page.length
  }

  return variants
}

const buildJobId = ({
  runId,
  actorId,
  variant
}: {
  runId: string
  actorId: string
  variant: RecreateFitnessRouteHeatmapVariant
}) =>
  getHashFromString(
    [
      'recreate-route-heatmap',
      runId,
      actorId,
      variant.activityType ?? 'all',
      variant.periodType,
      variant.periodKey,
      variant.region ?? ''
    ].join(':')
  )

const publishRouteHeatmapVariant = ({
  queue,
  runId,
  actorId,
  variant
}: {
  queue: Queue
  runId: string
  actorId: string
  variant: RecreateFitnessRouteHeatmapVariant
}) =>
  queue.publish({
    id: buildJobId({ runId, actorId, variant }),
    name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
    data: {
      actorId,
      activityType: variant.activityType,
      periodType: variant.periodType,
      periodKey: variant.periodKey,
      ...(variant.region ? { region: variant.region } : {})
    }
  })

const publishRouteHeatmapVariants = async ({
  queue,
  runId,
  actorId,
  variants
}: {
  queue: Queue
  runId: string
  actorId: string
  variants: RecreateFitnessRouteHeatmapVariant[]
}): Promise<PromiseSettledResult<void>[]> => {
  const results: PromiseSettledResult<void>[] = []
  let nextIndex = 0
  const workerCount = Math.min(
    ROUTE_HEATMAP_RECREATE_PUBLISH_CONCURRENCY,
    variants.length
  )

  const publishNextVariant = async () => {
    while (nextIndex < variants.length) {
      const index = nextIndex
      nextIndex += 1

      try {
        await publishRouteHeatmapVariant({
          queue,
          runId,
          actorId,
          variant: variants[index]
        })
        results[index] = { status: 'fulfilled', value: undefined }
      } catch (error) {
        results[index] = { status: 'rejected', reason: error }
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => publishNextVariant())
  )

  return results
}

export const recreateFitnessRouteHeatmapJobs = async ({
  database,
  actorId,
  dryRun = false,
  runId = randomUUID()
}: RecreateFitnessRouteHeatmapJobsParams): Promise<RecreateFitnessRouteHeatmapJobsResult> => {
  const [regions, baseVariants] = await Promise.all([
    database.getDistinctRouteHeatmapRegionsForActor({
      actorId,
      includeDeleted: true
    }),
    getCompletedPrimaryFitnessFileVariantsForActor(database, actorId)
  ])
  const variants = buildVariantsFromBaseMap({ baseVariants, regions })

  if (dryRun) {
    return {
      variants,
      deletedCount: 0,
      queuedCount: 0,
      failedCount: 0,
      errors: []
    }
  }

  const deletedCount = await database.deleteFitnessRouteHeatmapsForActor({
    actorId
  })
  const queue = getQueue()
  const errors: RecreateFitnessRouteHeatmapJobError[] = []
  let queuedCount = 0

  const publishResults = await publishRouteHeatmapVariants({
    queue,
    runId,
    actorId,
    variants
  })

  publishResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      queuedCount += 1
      return
    }

    const variant = variants[index]
    const error =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason)

    logger.warn({
      message: 'Failed to publish route heatmap recreation job',
      actorId,
      error,
      variant
    })
    if (variant) {
      errors.push({
        variant,
        error
      })
    }
  })

  return {
    variants,
    deletedCount,
    queuedCount,
    failedCount: errors.length,
    errors
  }
}

import crypto from 'crypto'

import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { FitnessRouteHeatmapPeriodType } from '@/lib/types/database/fitnessRouteHeatmap'
import { getHashFromString } from '@/lib/utils/getHashFromString'

const FITNESS_FILE_PAGE_SIZE = 500

export interface RecreateFitnessRouteHeatmapVariant {
  activityType: string | null
  periodType: FitnessRouteHeatmapPeriodType
  periodKey: string
  region?: string
}

export interface RecreateFitnessRouteHeatmapJobsDatabase {
  getDistinctRouteHeatmapRegionsForActor(params: {
    actorId: string
  }): Promise<string[]>
  getFitnessFilesByActor(params: {
    actorId: string
    processingStatus: 'completed'
    isPrimary: true
    limit: number
    offset: number
  }): Promise<FitnessFile[]>
  deleteFitnessRouteHeatmapsForActor(params: {
    actorId: string
  }): Promise<number>
}

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

  const sortedBaseVariants = Array.from(baseVariants.values()).sort(
    sortVariants
  )
  const variants = new Map<string, RecreateFitnessRouteHeatmapVariant>()

  for (const variant of sortedBaseVariants) {
    addVariant(variants, variant)
  }

  for (const region of normalizeRegions(regions)) {
    for (const variant of sortedBaseVariants) {
      addVariant(variants, { ...variant, region })
    }
  }

  return Array.from(variants.values()).sort(sortVariants)
}

const getCompletedPrimaryFitnessFilesForActor = async (
  database: RecreateFitnessRouteHeatmapJobsDatabase,
  actorId: string
) => {
  const fitnessFiles: FitnessFile[] = []
  let offset = 0

  while (true) {
    const page = await database.getFitnessFilesByActor({
      actorId,
      processingStatus: 'completed',
      isPrimary: true,
      limit: FITNESS_FILE_PAGE_SIZE,
      offset
    })

    fitnessFiles.push(...page)

    if (page.length < FITNESS_FILE_PAGE_SIZE) {
      break
    }

    offset += page.length
  }

  return fitnessFiles
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

export const recreateFitnessRouteHeatmapJobs = async ({
  database,
  actorId,
  dryRun = false,
  runId = crypto.randomUUID()
}: RecreateFitnessRouteHeatmapJobsParams): Promise<RecreateFitnessRouteHeatmapJobsResult> => {
  const [regions, fitnessFiles] = await Promise.all([
    database.getDistinctRouteHeatmapRegionsForActor({ actorId }),
    getCompletedPrimaryFitnessFilesForActor(database, actorId)
  ])
  const variants = buildRecreateFitnessRouteHeatmapVariants({
    fitnessFiles,
    regions
  })

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

  for (const variant of variants) {
    try {
      await queue.publish({
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
      queuedCount += 1
    } catch (error) {
      errors.push({
        variant,
        error: (error as Error).message
      })
    }
  }

  return {
    variants,
    deletedCount,
    queuedCount,
    failedCount: errors.length,
    errors
  }
}

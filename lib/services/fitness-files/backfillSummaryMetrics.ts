import { FitnessFile } from '@/lib/types/database/fitnessFile'

import { isParseableFitnessFileType } from './parseFitnessFile'

export interface BackfillSummaryMetricsResult {
  updated: number
  skipped: number
  failed: number
}

export interface SummaryMetricsData {
  avgPower?: number | null
  maxPower?: number | null
  avgHeartRate?: number | null
  maxHeartRate?: number | null
  totalWorkKj?: number | null
  elevationSeries?: number[] | null
}

export interface BackfillSummaryMetricsParams {
  files: FitnessFile[]
  force?: boolean
  dryRun?: boolean
  computeSummaryMetrics: (
    file: FitnessFile
  ) => Promise<SummaryMetricsData | null | undefined>
  updateSummaryMetrics: (
    fileId: string,
    metrics: SummaryMetricsData
  ) => Promise<void>
  onProgress?: (message: string) => void
}

const isBackfillCandidate = (file: FitnessFile, force: boolean): boolean => {
  if (file.deletedAt) return false
  if (file.processingStatus !== 'completed') return false
  if (!isParseableFitnessFileType(file.fileType)) return false
  if (
    !force &&
    (typeof file.avgPower === 'number' ||
      typeof file.avgHeartRate === 'number' ||
      typeof file.totalWorkKj === 'number' ||
      (Array.isArray(file.elevationSeries) && file.elevationSeries.length > 0))
  ) {
    return false
  }
  return true
}

export const backfillFitnessSummaryMetrics = async ({
  files,
  force = false,
  dryRun = false,
  computeSummaryMetrics,
  updateSummaryMetrics,
  onProgress
}: BackfillSummaryMetricsParams): Promise<BackfillSummaryMetricsResult> => {
  const result: BackfillSummaryMetricsResult = {
    updated: 0,
    skipped: 0,
    failed: 0
  }

  for (const file of files) {
    if (!isBackfillCandidate(file, force)) {
      result.skipped += 1
      continue
    }

    try {
      const metrics = await computeSummaryMetrics(file)
      if (!metrics) {
        result.skipped += 1
        onProgress?.(`skip ${file.id}: no summary metrics derivable`)
        continue
      }

      const normalizedMetrics: SummaryMetricsData = {
        avgPower: metrics.avgPower ?? null,
        maxPower: metrics.maxPower ?? null,
        avgHeartRate: metrics.avgHeartRate ?? null,
        maxHeartRate: metrics.maxHeartRate ?? null,
        totalWorkKj: metrics.totalWorkKj ?? null,
        elevationSeries: metrics.elevationSeries ?? null
      }

      const isElevationSeriesEqual =
        JSON.stringify(file.elevationSeries ?? null) ===
        JSON.stringify(normalizedMetrics.elevationSeries)

      const isUnchanged =
        (file.avgPower ?? null) === normalizedMetrics.avgPower &&
        (file.maxPower ?? null) === normalizedMetrics.maxPower &&
        (file.avgHeartRate ?? null) === normalizedMetrics.avgHeartRate &&
        (file.maxHeartRate ?? null) === normalizedMetrics.maxHeartRate &&
        (file.totalWorkKj ?? null) === normalizedMetrics.totalWorkKj &&
        isElevationSeriesEqual

      if (isUnchanged) {
        result.skipped += 1
        continue
      }

      if (!dryRun) {
        await updateSummaryMetrics(file.id, normalizedMetrics)
      }
      result.updated += 1
      onProgress?.(
        `${dryRun ? 'would update' : 'updated'} ${file.id}: avgPower=${normalizedMetrics.avgPower}, avgHR=${normalizedMetrics.avgHeartRate}, work=${normalizedMetrics.totalWorkKj}kJ, elevPoints=${normalizedMetrics.elevationSeries?.length ?? 0}`
      )
    } catch (error) {
      result.failed += 1
      onProgress?.(`error ${file.id}: ${(error as Error).message}`)
    }
  }

  return result
}

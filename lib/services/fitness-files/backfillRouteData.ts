import { FitnessFile } from '@/lib/types/database/fitnessFile'

import { isParseableFitnessFileType } from './parseFitnessFile'

export interface BackfillRouteDataResult {
  updated: number
  skipped: number
  failed: number
}

export interface BackfillRouteDataParams {
  files: FitnessFile[]
  force?: boolean
  dryRun?: boolean
  hasRouteData: (fileId: string) => Promise<boolean>
  computeAndSaveRouteData: (file: FitnessFile) => Promise<void>
  onProgress?: (message: string) => void
}

export const isRouteDataBackfillCandidate = (file: FitnessFile): boolean => {
  if (file.deletedAt) return false
  if (file.processingStatus !== 'completed') return false
  if (!isParseableFitnessFileType(file.fileType)) return false
  return true
}

export const backfillFitnessRouteData = async ({
  files,
  force = false,
  dryRun = false,
  hasRouteData,
  computeAndSaveRouteData,
  onProgress
}: BackfillRouteDataParams): Promise<BackfillRouteDataResult> => {
  const result: BackfillRouteDataResult = {
    updated: 0,
    skipped: 0,
    failed: 0
  }

  for (const file of files) {
    if (!isRouteDataBackfillCandidate(file)) {
      result.skipped += 1
      continue
    }

    try {
      if (!force) {
        const alreadyCached = await hasRouteData(file.id)
        if (alreadyCached) {
          result.skipped += 1
          continue
        }
      }

      if (dryRun) {
        result.updated += 1
        onProgress?.(`[dry-run] would backfill ${file.id}`)
        continue
      }

      await computeAndSaveRouteData(file)
      result.updated += 1
      onProgress?.(`backfilled route data for ${file.id}`)
    } catch (error) {
      result.failed += 1
      const message = error instanceof Error ? error.message : String(error)
      onProgress?.(`error processing ${file.id}: ${message}`)
    }
  }

  return result
}

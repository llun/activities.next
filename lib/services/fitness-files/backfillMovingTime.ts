import { FitnessFile } from '@/lib/types/database/fitnessFile'

import { isParseableFitnessFileType } from './parseFitnessFile'

export interface BackfillMovingTimeResult {
  updated: number
  skipped: number
  failed: number
}

export interface BackfillMovingTimeParams {
  files: FitnessFile[]
  force?: boolean
  dryRun?: boolean
  // Recomputes the moving time (seconds) for a file — typically by re-parsing
  // its stored bytes. Returns null/undefined when moving time cannot be derived
  // (no per-point data, unreadable file, ...).
  computeMovingTimeSeconds: (
    file: FitnessFile
  ) => Promise<number | null | undefined>
  updateMovingTimeSeconds: (
    fileId: string,
    movingTimeSeconds: number
  ) => Promise<void>
  onProgress?: (message: string) => void
}

// Only completed, parseable activity files can have a moving time recomputed. A
// file that already has a value is left alone unless `force` is set, so a rerun
// is cheap and idempotent.
const isBackfillCandidate = (file: FitnessFile, force: boolean): boolean => {
  if (file.deletedAt) return false
  if (file.processingStatus !== 'completed') return false
  if (!isParseableFitnessFileType(file.fileType)) return false
  if (!force && typeof file.movingTimeSeconds === 'number') return false
  return true
}

// Recomputes and persists `movingTimeSeconds` for already-stored fitness files.
// New imports get moving time during processing; this backfills records that
// were parsed before the column existed so their average pace/speed switches
// from elapsed-time to moving-time (matching Strava). Storage/parse/database
// access is injected so the core stays pure and unit-testable.
export const backfillFitnessMovingTime = async ({
  files,
  force = false,
  dryRun = false,
  computeMovingTimeSeconds,
  updateMovingTimeSeconds,
  onProgress
}: BackfillMovingTimeParams): Promise<BackfillMovingTimeResult> => {
  const result: BackfillMovingTimeResult = {
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
      const movingTimeSeconds = await computeMovingTimeSeconds(file)
      if (typeof movingTimeSeconds !== 'number' || movingTimeSeconds <= 0) {
        result.skipped += 1
        onProgress?.(`skip ${file.id}: no moving time derivable`)
        continue
      }

      if (file.movingTimeSeconds === movingTimeSeconds) {
        result.skipped += 1
        continue
      }

      if (!dryRun) {
        await updateMovingTimeSeconds(file.id, movingTimeSeconds)
      }
      result.updated += 1
      onProgress?.(
        `${dryRun ? 'would update' : 'updated'} ${file.id}: movingTimeSeconds=${movingTimeSeconds}`
      )
    } catch (error) {
      result.failed += 1
      onProgress?.(`error ${file.id}: ${(error as Error).message}`)
    }
  }

  return result
}

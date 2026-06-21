#!/usr/bin/env -S node scripts/run.cjs
/**
 * Re-runs failed fitness imports directly from the already-stored fitness files,
 * without needing Strava to re-send a webhook. Use this to recover activities
 * that imported the file to storage but failed to create the local status (e.g.
 * the orphaned-files-with-no-post case caused by a missing collection table on a
 * database that was mid-migration).
 *
 * For each failed file the correct importer is invoked in-process:
 *   - `strava-activity:<id>` batch → importStravaActivityJob (re-fetches the
 *     Strava activity, so caption/photos/visibility are restored)
 *   - any other batch (manual upload) → importFitnessFilesJob (recreates the
 *     post from the stored file)
 *
 * IMPORTANT: run this with the PRODUCTION database/storage/Strava env configured
 * (the same env Cloud Run uses). `NODE_ENV=production` alone only loads local
 * `.env*` files, so without the real connection settings it will connect to your
 * local database and find nothing to repair.
 *
 * Usage (all failed imports for an actor):
 *   NODE_ENV=production scripts/repairFailedFitnessImports.ts \
 *     --actor-id https://<host>/users/<username>
 *
 * Usage (only specific batches):
 *   NODE_ENV=production scripts/repairFailedFitnessImports.ts \
 *     --actor-id https://<host>/users/<username> \
 *     --batch-id strava-activity:19007245213 \
 *     [--batch-id <batch-id> ...]
 *
 * Options:
 *   --visibility <public|unlisted|private|direct>
 *       Visibility for recreated posts. Default `public`. Only applies to
 *       manual-upload batches; Strava-activity retries re-derive the activity's
 *       own visibility from Strava.
 *   --dry-run
 *       List what would be retried without changing anything.
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ACTIVITY_JOB_NAME
} from '@/lib/jobs/names'
import { getStravaActivityIdFromBatchId } from '@/lib/services/strava/activityBatch'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { getHashFromString } from '@/lib/utils/getHashFromString'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

const CliArgs = z.object({
  actorId: z.string().min(1),
  batchIds: z.array(z.string().min(1)).default([]),
  visibility: Visibility.default('public'),
  dryRun: z.boolean().default(false)
})

const USAGE = `Usage:
  Repair all failed imports for an actor:
    NODE_ENV=production scripts/repairFailedFitnessImports.ts \\
      --actor-id https://<host>/users/<username>

  Repair specific batches:
    NODE_ENV=production scripts/repairFailedFitnessImports.ts \\
      --actor-id https://<host>/users/<username> \\
      --batch-id strava-activity:<id> [--batch-id <batch-id> ...]

  Options:
    --visibility <public|unlisted|private|direct>  default public (manual batches only)
    --dry-run                                      list without changing anything`

const ACTOR_SCAN_PAGE_SIZE = 200

const parseArgs = (args: string[]) => {
  const batchIds: string[] = []
  let actorId: string | undefined
  let visibility: string | undefined
  let dryRun = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)

    if (rawKey === 'dry-run') {
      dryRun = true
      continue
    }

    const nextValue = inlineValue ?? args[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`)
    }

    if (inlineValue === undefined) {
      index += 1
    }

    if (rawKey === 'actor-id') {
      actorId = nextValue
    } else if (rawKey === 'batch-id') {
      batchIds.push(nextValue)
    } else if (rawKey === 'visibility') {
      visibility = nextValue
    } else {
      throw new Error(`Unknown argument: --${rawKey}`)
    }
  }

  return CliArgs.parse({ actorId, batchIds, visibility, dryRun })
}

// A true import failure: the file failed to create its status, so it has no
// statusId. Files that imported successfully but later failed map processing
// (statusId set, processingStatus 'failed') are NOT re-importable here — a
// re-import short-circuits past the importer, so retry would leave importStatus
// stuck. Those are handled by the processing-retry path (resumeStravaProcessing
// / retryFitnessProcessing) instead.
const isFailedImport = (file: FitnessFile): boolean =>
  file.importStatus === 'failed' && !file.statusId

const collectActorFailedBatchIds = async (
  database: NonNullable<ReturnType<typeof getDatabase>>,
  actorId: string
): Promise<{ batchIds: string[]; orphanCount: number }> => {
  const batchIds = new Set<string>()
  let orphanCount = 0
  let offset = 0

  for (;;) {
    const page = await database.getFitnessFilesByActor({
      actorId,
      limit: ACTOR_SCAN_PAGE_SIZE,
      offset
    })

    for (const file of page) {
      if (!isFailedImport(file)) continue
      if (file.importBatchId) {
        batchIds.add(file.importBatchId)
      } else {
        orphanCount += 1
      }
    }

    if (page.length < ACTOR_SCAN_PAGE_SIZE) break
    offset += ACTOR_SCAN_PAGE_SIZE
  }

  return { batchIds: [...batchIds], orphanCount }
}

const repairBatch = async ({
  database,
  actorId,
  batchId,
  visibility,
  dryRun
}: {
  database: NonNullable<ReturnType<typeof getDatabase>>
  actorId: string
  batchId: string
  visibility: z.infer<typeof Visibility>
  dryRun: boolean
}): Promise<'repaired' | 'skipped' | 'error'> => {
  const files = await database.getFitnessFilesByBatchId({ batchId })
  const actorFiles = files.filter((file) => file.actorId === actorId)
  const failedFiles = actorFiles.filter(isFailedImport)

  if (failedFiles.length === 0) {
    console.log(`  [${batchId}] no failed files, skipping`)
    return 'skipped'
  }

  const failedFileIds = failedFiles.map((file) => file.id)
  const stravaActivityId = getStravaActivityIdFromBatchId(batchId)

  if (dryRun) {
    console.log(
      `  [${batchId}] would retry ${failedFileIds.length} file(s) via ` +
        (stravaActivityId
          ? `Strava activity import (${stravaActivityId})`
          : 'file import')
    )
    return 'repaired'
  }

  try {
    // Sequential to avoid two concurrent UPDATEs racing on the same rows.
    await database.updateFitnessFilesImportStatus({
      fitnessFileIds: failedFileIds,
      importStatus: 'pending'
    })
    await database.updateFitnessFilesProcessingStatus({
      fitnessFileIds: failedFileIds,
      processingStatus: 'pending'
    })

    if (stravaActivityId) {
      await importStravaActivityJob(database, {
        id: getHashFromString(
          `repair:strava-activity:${actorId}:${stravaActivityId}`
        ),
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: { actorId, stravaActivityId }
      })
    } else {
      const overlapFitnessFileIds = actorFiles
        .filter(
          (file) => file.importStatus === 'completed' && Boolean(file.statusId)
        )
        .map((file) => file.id)

      await importFitnessFilesJob(database, {
        id: getHashFromString(`repair:fitness-import:${actorId}:${batchId}`),
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId,
          batchId,
          fitnessFileIds: failedFileIds,
          overlapFitnessFileIds,
          visibility
        }
      })
    }

    console.log(
      `  [${batchId}] retried ${failedFileIds.length} file(s) via ` +
        (stravaActivityId
          ? `Strava activity import (${stravaActivityId})`
          : 'file import')
    )
    return 'repaired'
  } catch (error) {
    const nodeError = error as Error
    console.error(`  [${batchId}] failed: ${nodeError.message}`)

    // The job threw after we reset the files to 'pending'. Restore them to
    // 'failed' (with the error) so they are not left stuck mid-retry and remain
    // retriable from the UI / a later run.
    try {
      for (const fileId of failedFileIds) {
        await database.updateFitnessFileImportStatus(
          fileId,
          'failed',
          nodeError.message
        )
        await database.updateFitnessFileProcessingStatus(fileId, 'failed')
      }
    } catch (resetError) {
      console.error(
        `  [${batchId}] failed to restore file status: ${(resetError as Error).message}`
      )
    }

    return 'error'
  }
}

export async function repairFailedFitnessImports(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  let input: z.infer<typeof CliArgs>
  try {
    input = parseArgs(args)
  } catch (error) {
    const nodeError = error as Error
    console.error(nodeError.message)
    console.error(USAGE)
    return 1
  }

  const database = getDatabase()
  if (!database) {
    console.error('Error: Database is not available')
    return 1
  }

  let batchIds = input.batchIds
  if (batchIds.length === 0) {
    const { batchIds: discoveredBatchIds, orphanCount } =
      await collectActorFailedBatchIds(database, input.actorId)
    batchIds = discoveredBatchIds

    if (orphanCount > 0) {
      console.log(
        `Note: ${orphanCount} failed file(s) have no import batch and cannot be retried automatically.`
      )
    }
  }

  if (batchIds.length === 0) {
    console.log('No failed fitness imports to repair for this actor')
    return 0
  }

  console.log(
    `Repairing ${batchIds.length} failed import batch(es) for actor ${input.actorId}` +
      (input.dryRun ? ' (dry run)' : '')
  )

  const counts = { repaired: 0, skipped: 0, error: 0 }
  for (const batchId of batchIds) {
    const result = await repairBatch({
      database,
      actorId: input.actorId,
      batchId,
      visibility: input.visibility,
      dryRun: input.dryRun
    })
    counts[result] += 1
  }

  console.log(
    `\nDone: ${counts.repaired} repaired, ${counts.skipped} skipped, ${counts.error} error(s)`
  )

  return counts.error > 0 ? 1 : 0
}

if (require.main === module) {
  repairFailedFitnessImports()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

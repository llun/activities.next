#!/usr/bin/env -S node -r @swc-node/register
/**
 * Resumes Phase 3 (processFitnessFileJob) for fitness files that were left
 * in 'pending' or 'processing' state after an interrupted importStravaArchive run.
 *
 * Usage:
 *   NODE_ENV=development scripts/resumeStravaProcessing.ts \
 *     --actor-id https://yourdomain.com/users/username \
 *     --batch-id strava-archive:<uuid>
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { getHashFromString } from '@/lib/utils/getHashFromString'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().min(1),
  batchId: z.string().min(1)
})

const USAGE = `Usage: NODE_ENV=development scripts/resumeStravaProcessing.ts \\
  --actor-id https://yourdomain.com/users/username \\
  --batch-id strava-archive:<uuid>`

const parseArgs = (args: string[]) => {
  const parsedArgs: Record<string, string> = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)
    const nextValue = inlineValue ?? args[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`)
    }

    if (inlineValue === undefined) {
      index += 1
    }

    parsedArgs[rawKey] = nextValue
  }

  return CliArgs.parse({
    actorId: parsedArgs['actor-id'],
    batchId: parsedArgs['batch-id']
  })
}

async function resumeStravaProcessing(args = process.argv.slice(2)) {
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

  const actor = await database.getActorFromId({ id: input.actorId })
  if (!actor) {
    console.error(`Error: Actor not found: ${input.actorId}`)
    return 1
  }

  // Find all fitness files in this batch that need processing
  const allFiles = await database.getFitnessFilesByBatchId({
    batchId: input.batchId
  })

  const pendingFiles = allFiles.filter(
    (f) =>
      f.statusId &&
      f.isPrimary &&
      (f.processingStatus === 'pending' || f.processingStatus === 'processing')
  )

  console.log(
    `Found ${pendingFiles.length} fitness files to process (out of ${allFiles.length} in batch)`
  )

  let processedCount = 0
  let failedCount = 0

  for (const fitnessFile of pendingFiles) {
    try {
      // Reset stuck 'processing' files back to a clean state
      if (fitnessFile.processingStatus === 'processing') {
        await database.updateFitnessFileProcessingStatus(
          fitnessFile.id,
          'pending'
        )
      }

      await processFitnessFileJob(database, {
        id: getHashFromString(`resume:process:${fitnessFile.id}`),
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: {
          actorId: actor.id,
          statusId: fitnessFile.statusId!,
          fitnessFileId: fitnessFile.id,
          publishSendNote: false
        }
      })
      processedCount += 1

      if (processedCount % 50 === 0) {
        console.log(
          `  [${processedCount + failedCount}/${pendingFiles.length}] processed ${processedCount}, failed ${failedCount}`
        )
      }
    } catch (error) {
      const nodeError = error as Error
      failedCount += 1
      console.warn(
        `  ✗ Failed to process ${fitnessFile.id}: ${nodeError.message}`
      )
    }
  }

  console.log(
    `\nDone: ${processedCount} processed, ${failedCount} failed out of ${pendingFiles.length}`
  )
  return failedCount > 0 ? 1 : 0
}

if (require.main === module) {
  resumeStravaProcessing()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

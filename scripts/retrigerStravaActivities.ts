#!/usr/bin/env -S node -r @swc-node/register
/**
 * Script to re-trigger Strava import for activities that were stored as plain
 * notes instead of fitness activities (e.g. indoor rides with no GPS data that
 * were imported before the TCX fallback fix).
 *
 * Each listed activity will be re-imported and stored as a proper fitness
 * activity.  The old plain-note statuses are NOT deleted automatically — delete
 * them from the web UI after confirming the new fitness statuses look correct.
 *
 * Usage:
 *   NODE_ENV=production scripts/retrigerStravaActivities.ts \
 *     --actor-id https://<host>/users/<username> \
 *     --activity-id <strava-activity-id> \
 *     [--activity-id <strava-activity-id> ...]
 *
 * The actor's Strava credentials are read from the database — no need to
 * supply tokens on the command line.
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import { IMPORT_STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { getHashFromString } from '@/lib/utils/getHashFromString'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().min(1),
  activityIds: z.array(z.string().min(1)).min(1)
})

const USAGE = `Usage: NODE_ENV=production scripts/retrigerStravaActivities.ts \\
  --actor-id https://<host>/users/<username> \\
  --activity-id <strava-activity-id> \\
  [--activity-id <strava-activity-id> ...]`

const parseArgs = (args: string[]) => {
  const activityIds: string[] = []
  let actorId: string | undefined

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

    if (rawKey === 'actor-id') {
      actorId = nextValue
    } else if (rawKey === 'activity-id') {
      activityIds.push(nextValue)
    } else {
      throw new Error(`Unknown argument: --${rawKey}`)
    }
  }

  return CliArgs.parse({ actorId, activityIds })
}

async function retrigerStravaActivities(args = process.argv.slice(2)) {
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

  console.log(
    `Re-triggering Strava import for actor ${input.actorId} — ${input.activityIds.length} activity(ies)`
  )
  console.log(
    'Note: old plain-note statuses for these activities will NOT be deleted automatically.'
  )
  console.log(
    'After confirming the new fitness statuses look correct, delete the old ones from the UI.\n'
  )

  let successCount = 0
  let failureCount = 0

  for (const activityId of input.activityIds) {
    const jobId = getHashFromString(
      `retrigger:${input.actorId}:${activityId}:${Date.now()}`
    )
    console.log(`  Importing activity ${activityId} ...`)

    try {
      await importStravaActivityJob(database, {
        id: jobId,
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: input.actorId,
          stravaActivityId: activityId
        }
      })
      console.log(`  ✓ Activity ${activityId} imported successfully`)
      successCount += 1
    } catch (error) {
      const nodeError = error as Error
      console.error(`  ✗ Activity ${activityId} failed: ${nodeError.message}`)
      failureCount += 1
    }
  }

  console.log(
    `\nDone: ${successCount} succeeded, ${failureCount} failed out of ${input.activityIds.length} total`
  )
  return failureCount > 0 ? 1 : 0
}

if (require.main === module) {
  retrigerStravaActivities()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

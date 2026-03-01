#!/usr/bin/env -S node -r @swc-node/register
/**
 * Script to run importStravaActivityJob with CLI-provided Strava credentials.
 * Usage:
 *   NODE_ENV=development scripts/runImportStravaActivity.ts \
 *     --actor-id <actor-id> \
 *     --activity-id <activity-id> \
 *     --strava-app-id <strava-app-id> \
 *     --strava-app-secret <strava-app-secret> \
 *     --access-token <access-token>
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { importStravaActivityJob } from '@/lib/jobs/importStravaActivityJob'
import { IMPORT_STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().min(1),
  activityId: z.string().min(1),
  stravaAppId: z.string().min(1),
  stravaAppSecret: z.string().min(1),
  accessToken: z.string().min(1)
})

const USAGE = `Usage: NODE_ENV=development scripts/runImportStravaActivity.ts --actor-id <actor-id> --activity-id <activity-id> --strava-app-id <strava-app-id> --strava-app-secret <strava-app-secret> --access-token <access-token>`

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
    activityId: parsedArgs['activity-id'],
    stravaAppId: parsedArgs['strava-app-id'],
    stravaAppSecret: parsedArgs['strava-app-secret'],
    accessToken: parsedArgs['access-token']
  })
}

async function runImportStravaActivity(args = process.argv.slice(2)) {
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
    `Running ${IMPORT_STRAVA_ACTIVITY_JOB_NAME} for actor ${input.actorId} and activity ${input.activityId}`
  )

  await importStravaActivityJob(database, {
    id: `cli:${input.actorId}:${input.activityId}:${Date.now()}`,
    name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
    data: {
      actorId: input.actorId,
      stravaActivityId: input.activityId,
      stravaAuth: {
        appId: input.stravaAppId,
        appSecret: input.stravaAppSecret,
        accessToken: input.accessToken
      }
    }
  })

  console.log('Strava import job completed')
  return 0
}

if (require.main === module) {
  runImportStravaActivity()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Strava import job failed:', error)
      process.exit(1)
    })
}

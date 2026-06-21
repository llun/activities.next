#!/usr/bin/env -S node scripts/run.cjs
/**
 * Recreates every discoverable route heatmap cache variant for one actor.
 *
 * The script soft-deletes existing route heatmap cache rows before queueing
 * fresh generation jobs with unique recreate IDs, so failed prior attempts do
 * not block the rebuild through queue deduplication.
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/recreateFitnessRouteHeatmaps.ts \
 *     --actor-id https://yourdomain.com/users/username
 *
 * Preview without deleting or queueing:
 *   NODE_ENV=production scripts/fitness/recreateFitnessRouteHeatmaps.ts \
 *     --actor-id https://yourdomain.com/users/username \
 *     --dry-run
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import {
  RecreateFitnessRouteHeatmapVariant,
  recreateFitnessRouteHeatmapJobs
} from '@/lib/jobs/recreateFitnessRouteHeatmapJobs'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().min(1),
  dryRun: z.boolean().default(false)
})

const USAGE = `Usage: NODE_ENV=production scripts/fitness/recreateFitnessRouteHeatmaps.ts \\
  --actor-id https://yourdomain.com/users/username \\
  [--dry-run [true|false]]`

const parseDryRunValue = (value?: string) => {
  if (value === undefined) {
    return true
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new Error(`Invalid value for --dry-run: ${value}. Use true or false.`)
}

export const parseArgs = (args: string[]) => {
  const parsedArgs: Record<string, string | boolean> = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)
    if (rawKey === 'dry-run') {
      const nextValue = args[index + 1]
      if (inlineValue !== undefined) {
        parsedArgs[rawKey] = parseDryRunValue(inlineValue)
        continue
      }

      if (nextValue && !nextValue.startsWith('--')) {
        parsedArgs[rawKey] = parseDryRunValue(nextValue)
        index += 1
        continue
      }

      parsedArgs[rawKey] = parseDryRunValue()
      continue
    }

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
    dryRun: parsedArgs['dry-run'] ?? false
  })
}

const formatVariant = ({
  activityType,
  periodType,
  periodKey,
  region
}: RecreateFitnessRouteHeatmapVariant) =>
  [
    activityType ?? 'all activities',
    `${periodType}:${periodKey}`,
    ...(region ? [`region:${region}`] : [])
  ].join(' | ')

async function recreateFitnessRouteHeatmaps(args = process.argv.slice(2)) {
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

  try {
    const actor = await database.getActorFromId({ id: input.actorId })
    if (!actor) {
      console.error(`Error: Actor not found: ${input.actorId}`)
      return 1
    }

    const result = await recreateFitnessRouteHeatmapJobs({
      database,
      actorId: actor.id,
      dryRun: input.dryRun
    })

    if (input.dryRun) {
      console.log(
        `Dry run: found ${result.variants.length} route heatmap variant(s) for ${actor.id}.`
      )

      for (const variant of result.variants) {
        console.log(`  - ${formatVariant(variant)}`)
      }

      return 0
    }

    console.log(
      `Deleted ${result.deletedCount} existing route heatmap cache row(s) for ${actor.id}.`
    )
    console.log(
      `Queued ${result.queuedCount} of ${result.variants.length} route heatmap generation job(s).`
    )

    if (result.failedCount > 0) {
      console.error(
        `Failed to queue ${result.failedCount} route heatmap generation job(s):`
      )
      for (const { variant, error } of result.errors) {
        console.error(`  - ${formatVariant(variant)}: ${error}`)
      }
    }

    return result.failedCount > 0 ? 1 : 0
  } finally {
    await database.destroy()
  }
}

if (require.main === module) {
  recreateFitnessRouteHeatmaps()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

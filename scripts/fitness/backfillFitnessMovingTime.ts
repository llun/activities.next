#!/usr/bin/env -S node scripts/run.cjs
/**
 * Backfills `movingTimeSeconds` for an actor's already-stored fitness files.
 *
 * Average pace/speed is measured over MOVING time (stops excluded), the way
 * Strava reports it. Files imported before the `movingTimeSeconds` column
 * existed still show the slower elapsed-time speed until their moving time is
 * recomputed. This script re-parses each completed activity file from storage
 * and persists the derived moving time; new imports already compute it during
 * processing, so this is only needed once for historical records.
 *
 * Files that already have a moving time are skipped unless `--force` is given,
 * so reruns are cheap and idempotent.
 *
 * IMPORTANT: run this with the PRODUCTION database/storage env configured (the
 * same env the app uses). `NODE_ENV=production` alone only loads local `.env*`
 * files, so without the real connection settings it connects to your local
 * database and finds nothing to backfill.
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/backfillFitnessMovingTime.ts \
 *     --actor-id https://<host>/users/<username> \
 *     [--force] [--dry-run [true|false]]
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import { backfillFitnessMovingTime } from '@/lib/services/fitness-files/backfillMovingTime'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().min(1),
  force: z.boolean().default(false),
  dryRun: z.boolean().default(false)
})

const USAGE = `Usage: NODE_ENV=production scripts/fitness/backfillFitnessMovingTime.ts \\
  --actor-id https://<host>/users/<username> \\
  [--force] [--dry-run [true|false]]`

const ACTOR_SCAN_PAGE_SIZE = 200

const parseBooleanFlagValue = (value?: string) => {
  if (value === undefined || value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid boolean value: ${value}. Use true or false.`)
}

export const parseArgs = (args: string[]) => {
  const parsed: Record<string, string | boolean> = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)

    if (rawKey === 'force' || rawKey === 'dry-run') {
      const nextValue = args[index + 1]
      if (inlineValue !== undefined) {
        parsed[rawKey] = parseBooleanFlagValue(inlineValue)
        continue
      }
      if (nextValue && !nextValue.startsWith('--')) {
        parsed[rawKey] = parseBooleanFlagValue(nextValue)
        index += 1
        continue
      }
      parsed[rawKey] = true
      continue
    }

    const nextValue = inlineValue ?? args[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`)
    }
    if (inlineValue === undefined) index += 1
    parsed[rawKey] = nextValue
  }

  return CliArgs.parse({
    actorId: parsed['actor-id'],
    force: parsed['force'] ?? false,
    dryRun: parsed['dry-run'] ?? false
  })
}

async function backfillFitnessMovingTimeScript(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  let input: z.infer<typeof CliArgs>
  try {
    input = parseArgs(args)
  } catch (error) {
    console.error((error as Error).message)
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

    const totals = { updated: 0, skipped: 0, failed: 0 }
    let offset = 0

    for (;;) {
      const page = await database.getFitnessFilesByActor({
        actorId: actor.id,
        limit: ACTOR_SCAN_PAGE_SIZE,
        offset
      })
      if (page.length === 0) break

      const result = await backfillFitnessMovingTime({
        files: page,
        force: input.force,
        dryRun: input.dryRun,
        computeMovingTimeSeconds: async (file) => {
          if (!isParseableFitnessFileType(file.fileType)) return undefined
          const buffer = await getFitnessFileBuffer(database, file.id, file)
          const activityData = await parseFitnessFile({
            fileType: file.fileType,
            buffer
          })
          return activityData.movingTimeSeconds ?? null
        },
        updateMovingTimeSeconds: async (fileId, movingTimeSeconds) => {
          await database.updateFitnessFileActivityData(fileId, {
            movingTimeSeconds
          })
        },
        onProgress: (message) => console.log(`  ${message}`)
      })

      totals.updated += result.updated
      totals.skipped += result.skipped
      totals.failed += result.failed

      if (page.length < ACTOR_SCAN_PAGE_SIZE) break
      offset += ACTOR_SCAN_PAGE_SIZE
    }

    console.log(
      `\nDone${input.dryRun ? ' (dry run)' : ''}: ${totals.updated} updated, ` +
        `${totals.skipped} skipped, ${totals.failed} error(s).`
    )

    return totals.failed > 0 ? 1 : 0
  } finally {
    await database.destroy()
  }
}

if (require.main === module) {
  backfillFitnessMovingTimeScript()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

export { backfillFitnessMovingTimeScript }

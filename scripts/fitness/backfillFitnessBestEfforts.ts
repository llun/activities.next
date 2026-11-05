#!/usr/bin/env -S node scripts/run.cjs
/**
 * Backfills `fitness_best_efforts` for an actor's already-processed fitness
 * files, so activities imported before records existed show on the Records
 * page and earn PR badges. New imports compute their efforts while processing.
 *
 * Reads each file's cached route data (`fitness_file_route_data`); a file with
 * no current cache row is parsed from storage once and its cache written, as
 * `backfillFitnessRouteData.ts` does. Pages through the actor's completed files
 * 200 at a time and skips files that already have efforts unless `--force`, so
 * an interrupted run picks up where it stopped. A file with no power and no
 * run distance stores nothing and is looked at again on the next run.
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/backfillFitnessBestEfforts.ts \
 *     --actor-id https://<host>/users/<username> \
 *     [--force] [--dry-run [true|false]]
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import { saveFitnessBestEfforts } from '@/lib/services/fitness-files/bestEfforts'
import {
  createPreParsedRouteDataPayload,
  loadPreParsedRouteData,
  savePreParsedRouteData
} from '@/lib/services/fitness-files/fileRouteDataCache'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'

import { printDatabaseBanner } from './describeConnection'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().min(1),
  force: z.boolean().default(false),
  dryRun: z.boolean().default(false)
})

const USAGE = `Usage: NODE_ENV=production scripts/fitness/backfillFitnessBestEfforts.ts \\
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

async function backfillFitnessBestEffortsScript(args = process.argv.slice(2)) {
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
    printDatabaseBanner()

    const actor = await database.getActorFromId({ id: input.actorId })
    if (!actor) {
      console.error(`Error: Actor not found: ${input.actorId}`)
      return 1
    }

    console.log(`Scanning fitness files for actor: ${actor.id}`)
    const totals = { updated: 0, skipped: 0, failed: 0 }
    let offset = 0

    for (;;) {
      const page = await database.getFitnessFilesByActor({
        actorId: actor.id,
        limit: ACTOR_SCAN_PAGE_SIZE,
        offset,
        processingStatus: 'completed'
      })
      if (page.length === 0) break

      const done = input.force
        ? new Set<string>()
        : new Set(
            (
              await database.getFitnessBestEfforts({
                fitnessFileIds: page.map((file) => file.id)
              })
            ).map((effort) => effort.fitnessFileId)
          )

      for (const file of page) {
        const statusId = file.statusId
        if (
          file.deletedAt ||
          !statusId ||
          !isParseableFitnessFileType(file.fileType) ||
          done.has(file.id)
        ) {
          totals.skipped += 1
          continue
        }
        if (input.dryRun) {
          totals.updated += 1
          console.log(`  [dry-run] would backfill ${file.id}`)
          continue
        }

        try {
          let payload = await loadPreParsedRouteData(database, file.id)
          if (!payload) {
            const buffer = await getFitnessFileBuffer(database, file.id, file)
            const activityData = await parseFitnessFile({
              fileType: file.fileType,
              buffer
            })
            payload = createPreParsedRouteDataPayload(activityData)
            await savePreParsedRouteData(database, {
              fitnessFileId: file.id,
              actorId: file.actorId,
              payload
            })
          }
          const efforts = await saveFitnessBestEfforts(database, {
            fitnessFileId: file.id,
            actorId: file.actorId,
            statusId,
            activityType: file.activityType ?? null,
            activityDate: file.activityStartTime ?? file.createdAt,
            movingTimeSeconds: file.movingTimeSeconds ?? null,
            payload
          })
          totals.updated += 1
          console.log(`  ${file.id}: ${efforts.length} effort(s)`)
        } catch (error) {
          totals.failed += 1
          console.error(`  ${file.id}: failed`, error)
        }
      }

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
  backfillFitnessBestEffortsScript()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

export { backfillFitnessBestEffortsScript }

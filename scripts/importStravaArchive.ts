#!/usr/bin/env -S node -r @swc-node/register
/**
 * Imports a Strava archive ZIP locally without a queue worker.
 *
 * Usage:
 *   NODE_ENV=production scripts/importStravaArchive.ts \
 *     --archive-path /path/to/export.zip \
 *     --actor-id https://yourdomain.com/users/username \
 *     [--visibility public|unlisted|private|direct]
 *
 * Set NODE_ENV=production to load .env.production; omit for dev env files.
 */
import { loadEnvConfig } from '@next/env'
import crypto from 'crypto'
import path from 'path'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { getStravaArchiveImportBatchId } from '@/lib/services/strava/archiveImport'
import {
  StravaArchiveReader,
  getArchiveMediaMimeType,
  toStravaArchiveFitnessFilePayload
} from '@/lib/services/strava/archiveReader'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

const CliArgs = z.object({
  archivePath: z.string().min(1),
  actorId: z.string().min(1),
  visibility: Visibility.default('private')
})

const USAGE = `Usage: NODE_ENV=production scripts/importStravaArchive.ts \\
  --archive-path /path/to/export.zip \\
  --actor-id https://yourdomain.com/users/username \\
  [--visibility public|unlisted|private|direct]`

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
    archivePath: parsedArgs['archive-path'],
    actorId: parsedArgs['actor-id'],
    visibility: parsedArgs['visibility']
  })
}

async function importStravaArchive(args = process.argv.slice(2)) {
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

  console.log(`Actor resolved: ${actor.username}@${actor.domain}`)

  const archiveId = crypto.randomUUID()
  const batchId = getStravaArchiveImportBatchId(archiveId)

  const resolvedArchivePath = path.resolve(input.archivePath)
  let archiveReader: StravaArchiveReader | null = null

  try {
    archiveReader = await StravaArchiveReader.open(resolvedArchivePath)
    const archiveActivities = await archiveReader.getActivities()
    const totalActivities = archiveActivities.length
    console.log(`Found ${totalActivities} activities in archive`)

    // Phase 2: save each activity's fitness file
    const savedFiles: Array<{
      fitnessFileId: string
      mediaPaths: string[]
      activityId: string
      activityName?: string
    }> = []

    let savedCount = 0
    let failedCount = 0

    for (const activity of archiveActivities) {
      try {
        const fitnessBuffer = await archiveReader.readEntryBuffer(
          activity.fitnessFilePath
        )
        if (!fitnessBuffer) {
          throw new Error('Fitness activity file is missing from archive')
        }

        const fitnessPayload = toStravaArchiveFitnessFilePayload({
          fitnessFilePath: activity.fitnessFilePath,
          buffer: fitnessBuffer
        })

        const fitnessFile = new File(
          [new Uint8Array(fitnessPayload.buffer)],
          fitnessPayload.fileName,
          { type: fitnessPayload.mimeType }
        )

        const savedFitnessFile = await saveFitnessFile(database, actor, {
          file: fitnessFile,
          importBatchId: batchId,
          description: activity.activityDescription || activity.activityName
        })

        if (!savedFitnessFile) {
          throw new Error(
            'saveFitnessFile returned null — check storage config'
          )
        }

        savedFiles.push({
          fitnessFileId: savedFitnessFile.id,
          mediaPaths: activity.mediaPaths,
          activityId: activity.activityId,
          activityName: activity.activityName
        })

        savedCount += 1
        console.log(
          `  [${savedCount + failedCount}/${totalActivities}] ✓ Saved activity ${activity.activityId}`
        )
      } catch (error) {
        const nodeError = error as Error
        failedCount += 1
        console.warn(
          `  [${savedCount + failedCount}/${totalActivities}] ✗ Failed activity ${activity.activityId}: ${nodeError.message}`
        )
      }
    }

    console.log(`\nPhase 2 done: ${savedCount} saved, ${failedCount} failed`)

    // Phases 3 & 4 will go here

    return failedCount > 0 ? 1 : 0
  } finally {
    archiveReader?.close()
  }
}

if (require.main === module) {
  importStravaArchive()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

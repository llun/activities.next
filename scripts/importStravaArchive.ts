#!/usr/bin/env -S node -r @swc-node/register
/**
 * Imports a Strava archive ZIP locally without a queue worker.
 * Run with --help to see usage.
 */
import { loadEnvConfig } from '@next/env'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME
} from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { saveMedia } from '@/lib/services/medias'
import { MAX_ATTACHMENTS } from '@/lib/services/medias/constants'
import { getQueue } from '@/lib/services/queue'
import { getStravaArchiveImportBatchId } from '@/lib/services/strava/archiveImport'
import {
  StravaArchiveReader,
  getArchiveMediaMimeType,
  toStravaArchiveFitnessFilePayload
} from '@/lib/services/strava/archiveReader'
import { getHashFromString } from '@/lib/utils/getHashFromString'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

const CliArgs = z.object({
  archivePath: z.string().min(1),
  actorId: z.string().min(1),
  visibility: Visibility.default('private'),
  skipToIndex: z.coerce.number().int().min(0).default(0),
  retryFile: z.string().optional(),
  failedOutput: z.string().default('strava-import-failed.txt')
})

const USAGE = `Usage: NODE_ENV=production scripts/importStravaArchive.ts \\
  --archive-path /path/to/export.zip \\
  --actor-id https://yourdomain.com/users/username \\
  [--visibility public|unlisted|private|direct] \\
  [--skip-to-index N] \\
  [--retry-file strava-import-failed.txt] \\
  [--failed-output strava-import-failed.txt]`

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
    visibility: parsedArgs['visibility'],
    skipToIndex: parsedArgs['skip-to-index'],
    retryFile: parsedArgs['retry-file'],
    failedOutput: parsedArgs['failed-output']
  })
}

const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> => {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms: ${label}`)),
      ms
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!))
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
    if (!(error instanceof z.ZodError)) {
      console.error((error as Error).message)
    }
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
    let processFailedCount = 0
    const failedActivityIds: string[] = []

    const SAVE_TIMEOUT_MS = 30_000

    let activitiesToProcess = archiveActivities

    if (input.retryFile) {
      let retryFileContent: string
      try {
        retryFileContent = await fs.readFile(input.retryFile, 'utf8')
      } catch (error) {
        throw new Error(
          `Retry file not found or unreadable: ${input.retryFile}`,
          { cause: error }
        )
      }
      const retryIds = new Set(
        retryFileContent
          .split(/\r?\n/)
          .map((id) => id.trim())
          .filter(Boolean)
      )
      activitiesToProcess = archiveActivities.filter((a) =>
        retryIds.has(a.activityId)
      )
      console.log(
        `Retrying ${activitiesToProcess.length} of ${totalActivities} activities from ${input.retryFile}`
      )
    } else if (input.skipToIndex > 0) {
      activitiesToProcess = archiveActivities.slice(input.skipToIndex)
      console.log(
        `Skipping first ${input.skipToIndex} activities (--skip-to-index)`
      )
    }

    const totalToProcess = activitiesToProcess.length

    for (const activity of activitiesToProcess) {
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

        const savedFitnessFile = await withTimeout(
          saveFitnessFile(database, actor, {
            file: fitnessFile,
            importBatchId: batchId,
            description: activity.activityDescription || activity.activityName
          }),
          SAVE_TIMEOUT_MS,
          `saveFitnessFile(${activity.activityId})`
        )

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
          `  [${savedCount + failedCount}/${totalToProcess}] ✓ Saved activity ${activity.activityId}`
        )
      } catch (error) {
        const nodeError = error as Error
        failedCount += 1
        failedActivityIds.push(activity.activityId)
        console.warn(
          `  [${savedCount + failedCount}/${totalToProcess}] ✗ Failed activity ${activity.activityId}: ${nodeError.message}`
        )
      }
    }

    console.log(`\nPhase 2 done: ${savedCount} saved, ${failedCount} failed`)

    if (failedActivityIds.length > 0) {
      try {
        await fs.writeFile(
          input.failedOutput,
          failedActivityIds.join('\n') + '\n'
        )
        console.log(`\nFailed activity IDs written to: ${input.failedOutput}`)
        console.log(`Retry with: --retry-file ${input.failedOutput}`)
      } catch (error) {
        const nodeError = error as Error
        console.warn(
          `\nWarning: could not write retry file ${input.failedOutput}: ${nodeError.message}`
        )
      }
    } else if (input.retryFile) {
      try {
        await fs.writeFile(input.failedOutput, '')
      } catch {
        // clearing the file is best-effort
      }
    }

    // Phase 3: create statuses and process fitness files inline
    if (savedFiles.length > 0) {
      console.log('\nPhase 3: importing fitness files and creating statuses…')

      const savedFileIds = savedFiles.map((f) => f.fitnessFileId)

      // Stub queue.publish so importFitnessFilesJob's internal
      // getQueue().publish(PROCESS_FITNESS_FILE_JOB_NAME) calls are no-ops.
      // We call processFitnessFileJob directly below instead.
      const queue = getQueue()
      const originalPublish = queue.publish.bind(queue)
      queue.publish = async () => {}

      try {
        await importFitnessFilesJob(database, {
          id: getHashFromString(`script:import-fitness:${archiveId}`),
          name: IMPORT_FITNESS_FILES_JOB_NAME,
          data: {
            actorId: actor.id,
            batchId,
            fitnessFileIds: savedFileIds,
            overlapFitnessFileIds: [],
            visibility: input.visibility
          }
        })
      } finally {
        queue.publish = originalPublish
      }

      // Find which fitness files got a statusId assigned (primary files only)
      const updatedFiles = await database.getFitnessFilesByIds({
        fitnessFileIds: savedFileIds
      })

      const primaryFilesWithStatus = updatedFiles.filter(
        (f) => f.isPrimary && f.statusId
      )

      console.log(
        `  Created ${primaryFilesWithStatus.length} status(es). Processing…`
      )

      let processedCount = 0
      for (const fitnessFile of primaryFilesWithStatus) {
        try {
          await processFitnessFileJob(database, {
            id: getHashFromString(`script:process:${fitnessFile.id}`),
            name: PROCESS_FITNESS_FILE_JOB_NAME,
            data: {
              actorId: actor.id,
              statusId: fitnessFile.statusId!,
              fitnessFileId: fitnessFile.id,
              publishSendNote: false
            }
          })
          processedCount += 1
        } catch (error) {
          const nodeError = error as Error
          processFailedCount += 1
          console.warn(
            `  ✗ Failed to process fitness file ${fitnessFile.id}: ${nodeError.message}`
          )
        }
      }

      console.log(
        `Phase 3 done: ${processedCount} processed, ${processFailedCount} failed`
      )
    }

    // Phase 4: attach photos from archive to statuses
    const activitiesWithMedia = savedFiles.filter(
      (f) => f.mediaPaths.length > 0
    )

    if (activitiesWithMedia.length > 0) {
      console.log(
        `\nPhase 4: attaching media for ${activitiesWithMedia.length} activity(ies)…`
      )

      // Re-fetch to get final statusIds after processing
      const allFinalFiles = await database.getFitnessFilesByIds({
        fitnessFileIds: savedFiles.map((f) => f.fitnessFileId)
      })
      const fitnessFileStatusMap = new Map(
        allFinalFiles.filter((f) => f.statusId).map((f) => [f.id, f.statusId!])
      )

      let mediaAttached = 0
      let mediaFailed = 0

      for (const activity of activitiesWithMedia) {
        const statusId = fitnessFileStatusMap.get(activity.fitnessFileId)
        if (!statusId) {
          console.warn(
            `  ✗ No status for activity ${activity.activityId} — skipping media`
          )
          continue
        }

        const existingAttachments = await database.getAttachments({ statusId })
        const attachmentNames = new Set(
          existingAttachments
            .map((a) => a.name ?? '')
            .filter((n) => n.length > 0)
        )
        let remainingSlots = Math.max(
          0,
          MAX_ATTACHMENTS - existingAttachments.length
        )

        for (const mediaPath of activity.mediaPaths) {
          if (remainingSlots <= 0) break

          const mimeType = getArchiveMediaMimeType(mediaPath)
          if (!mimeType) continue
          if (!archiveReader!.hasEntry(mediaPath)) {
            console.warn(`  ✗ Media missing from archive: ${mediaPath}`)
            continue
          }

          try {
            const mediaBuffer = await archiveReader!.readEntryBuffer(mediaPath)
            if (!mediaBuffer || mediaBuffer.length === 0) continue

            const mediaFile = new File(
              [new Uint8Array(mediaBuffer)],
              path.basename(mediaPath),
              { type: mimeType }
            )

            const storedMedia = await saveMedia(database, actor, {
              file: mediaFile,
              description: activity.activityName || 'Strava archive media'
            })
            if (!storedMedia) continue

            const ATTACHMENT_NAME_LIMIT = 150
            const originalName = path.basename(mediaPath)
            let attachmentName =
              originalName.length <= ATTACHMENT_NAME_LIMIT
                ? originalName
                : originalName.slice(0, ATTACHMENT_NAME_LIMIT)
            if (attachmentNames.has(attachmentName)) {
              const ext = path.extname(originalName)
              const stem = path.basename(originalName, ext)
              let resolved = false
              for (let suffix = 2; suffix <= 999; suffix += 1) {
                const s = ` (${suffix})`
                const maxStem = ATTACHMENT_NAME_LIMIT - ext.length - s.length
                const candidate = `${stem.slice(0, maxStem)}${s}${ext}`
                if (!attachmentNames.has(candidate)) {
                  attachmentName = candidate
                  resolved = true
                  break
                }
              }
              if (!resolved) {
                const s = `-${Date.now().toString(36).slice(-4)}`
                const maxStem = ATTACHMENT_NAME_LIMIT - ext.length - s.length
                attachmentName = `${stem.slice(0, maxStem)}${s}${ext}`
              }
            }
            attachmentNames.add(attachmentName)

            await database.createAttachment({
              actorId: actor.id,
              statusId,
              mediaType: storedMedia.mime_type,
              url: storedMedia.url,
              width: storedMedia.meta.original.width,
              height: storedMedia.meta.original.height,
              name: attachmentName,
              mediaId: storedMedia.id
            })

            remainingSlots -= 1
            mediaAttached += 1
          } catch (error) {
            const nodeError = error as Error
            console.warn(
              `  ✗ Failed to attach ${mediaPath}: ${nodeError.message}`
            )
            mediaFailed += 1
          }
        }
      }

      console.log(
        `Phase 4 done: ${mediaAttached} photo(s) attached, ${mediaFailed} failed`
      )
    }

    console.log('\n=== Import complete ===')
    console.log(`Activities saved:    ${savedCount}`)
    console.log(`Save failures:       ${failedCount}`)
    console.log(`Process failures:    ${processFailedCount}`)
    console.log(`Archive ID:          ${archiveId}`)
    console.log(`Batch ID:            ${batchId}`)

    return failedCount > 0 || processFailedCount > 0 ? 1 : 0
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

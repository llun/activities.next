import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createWriteStream } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeReadableStream } from 'stream/web'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { IMPORT_FITNESS_FILES_JOB_NAME } from '@/lib/jobs/names'
import {
  deleteFitnessFile,
  saveFitnessFile
} from '@/lib/services/fitness-files'
import { MAX_ATTACHMENTS } from '@/lib/services/medias/constants'
import { saveMedia } from '@/lib/services/medias/index'
import { getQueue } from '@/lib/services/queue'
import {
  StravaArchiveActivity,
  StravaArchiveReader,
  getArchiveMediaMimeType,
  toStravaArchiveFitnessFilePayload
} from '@/lib/services/strava/archiveReader'
import { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { IMPORT_STRAVA_ARCHIVE_JOB_NAME } from './names'

const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

const PendingMediaActivity = z.object({
  fitnessFileId: z.string(),
  activityId: z.string(),
  activityName: z.string().optional(),
  mediaPaths: z.array(z.string())
})

const JobData = z.object({
  actorId: z.string(),
  archiveId: z.string(),
  archiveFitnessFileId: z.string(),
  batchId: z.string(),
  visibility: Visibility.default('public'),
  nextActivityIndex: z.number().int().nonnegative().default(0),
  pendingMediaActivities: z.array(PendingMediaActivity).optional(),
  mediaAttachmentRetry: z.number().int().nonnegative().default(0),
  totalActivitiesCount: z.number().int().nonnegative().optional(),
  completedActivitiesCount: z.number().int().nonnegative().default(0),
  failedActivitiesCount: z.number().int().nonnegative().default(0),
  firstFailureMessage: z.string().optional()
})

// Keep room for " (n)" dedupe suffixes while preserving readable filenames.
const ATTACHMENT_FILE_NAME_LIMIT = 150
// Retry media attachment for about one minute in production (12 * 5s).
const MAX_MEDIA_ATTACHMENT_RETRIES = 12
const MEDIA_ATTACHMENT_RETRY_DELAY_SECONDS = 5
const MEDIA_ATTACHMENT_RETRY_DELAY_MS =
  process.env.NODE_ENV === 'test'
    ? 0
    : MEDIA_ATTACHMENT_RETRY_DELAY_SECONDS * 1_000
const MAX_IMPORT_JOB_RUNTIME_MS = 5 * 60 * 1_000
const IMPORT_JOB_REQUEUE_BUFFER_MS = 10 * 1_000

const truncateAttachmentName = (fileName: string): string => {
  if (fileName.length <= ATTACHMENT_FILE_NAME_LIMIT) {
    return fileName
  }
  return fileName.slice(0, ATTACHMENT_FILE_NAME_LIMIT)
}

const getUniqueAttachmentName = ({
  baseName,
  existingNames
}: {
  baseName: string
  existingNames: Set<string>
}): string => {
  const truncatedBaseName = truncateAttachmentName(baseName)
  if (!existingNames.has(truncatedBaseName)) {
    return truncatedBaseName
  }

  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = truncateAttachmentName(`${truncatedBaseName} (${suffix})`)
    if (!existingNames.has(candidate)) {
      return candidate
    }
  }

  return truncateAttachmentName(
    `${truncatedBaseName}-${Date.now().toString(36).slice(-4)}`
  )
}

const streamBodyToFile = async ({
  body,
  outputPath
}: {
  body: unknown
  outputPath: string
}) => {
  if (body && typeof body === 'object' && 'pipe' in body) {
    await pipeline(body as NodeJS.ReadableStream, createWriteStream(outputPath))
    return
  }

  if (
    body &&
    typeof body === 'object' &&
    'transformToWebStream' in body &&
    typeof (body as { transformToWebStream: () => NodeReadableStream })
      .transformToWebStream === 'function'
  ) {
    const webStream = (
      body as { transformToWebStream: () => NodeReadableStream }
    ).transformToWebStream()
    await pipeline(Readable.fromWeb(webStream), createWriteStream(outputPath))
    return
  }

  if (
    body &&
    typeof body === 'object' &&
    'transformToByteArray' in body &&
    typeof (body as { transformToByteArray: () => Promise<Uint8Array> })
      .transformToByteArray === 'function'
  ) {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray()
    await fs.writeFile(outputPath, bytes)
    return
  }

  throw new Error('Unable to read archive object body stream')
}

const resolveArchivePath = async (
  archivePath: string,
  archiveFitnessFileId: string
): Promise<{ archiveFilePath: string; cleanup: () => Promise<void> }> => {
  const { fitnessStorage } = getConfig()
  if (!fitnessStorage) {
    throw new Error('Fitness storage is not configured')
  }

  if (fitnessStorage.type === 'fs') {
    return {
      archiveFilePath: path.resolve(fitnessStorage.path, archivePath),
      cleanup: async () => {}
    }
  }

  const key = fitnessStorage.prefix
    ? `${fitnessStorage.prefix}${archivePath}`
    : archivePath
  const temporaryArchivePath = path.resolve(
    os.tmpdir(),
    `strava-archive-${archiveFitnessFileId}-${Date.now()}.zip`
  )

  const client = new S3Client({ region: fitnessStorage.region })
  const object = await client.send(
    new GetObjectCommand({
      Bucket: fitnessStorage.bucket,
      Key: key
    })
  )
  if (!object.Body) {
    throw new Error('Archive object body is empty')
  }

  await streamBodyToFile({
    body: object.Body,
    outputPath: temporaryArchivePath
  })

  return {
    archiveFilePath: temporaryArchivePath,
    cleanup: async () => {
      await fs.unlink(temporaryArchivePath).catch(() => undefined)
    }
  }
}

const sleep = async (ms: number) => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

const hasReachedRuntimeDeadline = (runtimeDeadlineMs: number): boolean => {
  return Date.now() >= runtimeDeadlineMs
}

const getImportedFitnessFiles = async ({
  database,
  fitnessFileIds
}: {
  database: Database
  fitnessFileIds: string[]
}) => {
  const files = await database.getFitnessFilesByIds({
    fitnessFileIds
  })

  const importedFiles = new Map<
    string,
    {
      statusId?: string | null
      importStatus?: 'pending' | 'completed' | 'failed'
      importError?: string
    }
  >()

  for (const file of files) {
    importedFiles.set(file.id, {
      statusId: file.statusId,
      importStatus: file.importStatus,
      importError: file.importError
    })
  }

  return importedFiles
}

const attachActivityMediaToStatus = async ({
  database,
  actor,
  actorId,
  statusId,
  activity,
  archiveReader,
  archiveId
}: {
  database: Database
  actor: Actor
  actorId: string
  statusId: string
  activity: Pick<
    StravaArchiveActivity,
    'activityId' | 'activityName' | 'mediaPaths'
  >
  archiveReader: StravaArchiveReader
  archiveId: string
}) => {
  const existingAttachments = await database.getAttachments({ statusId })
  const attachmentNames = new Set(
    existingAttachments
      .map((attachment) => attachment.name ?? '')
      .filter((name) => name.length > 0)
  )
  const remainingSlots = Math.max(
    0,
    MAX_ATTACHMENTS - existingAttachments.length
  )
  if (remainingSlots <= 0) {
    return
  }

  for (const mediaPath of activity.mediaPaths.slice(0, remainingSlots)) {
    const mimeType = getArchiveMediaMimeType(mediaPath)
    if (!mimeType) {
      continue
    }

    if (!archiveReader.hasEntry(mediaPath)) {
      logger.warn({
        message: 'Strava archive media is missing from archive',
        actorId,
        archiveId,
        activityId: activity.activityId,
        mediaPath
      })
      continue
    }

    try {
      const mediaBuffer = await archiveReader.readEntryBuffer(mediaPath)
      if (!mediaBuffer || mediaBuffer.length === 0) {
        continue
      }

      const mediaFile = new File(
        [new Uint8Array(mediaBuffer)],
        path.basename(mediaPath),
        {
          type: mimeType
        }
      )
      const storedMedia = await saveMedia(database, actor, {
        file: mediaFile,
        description: activity.activityName || 'Strava archive media'
      })
      if (!storedMedia) {
        continue
      }

      const attachmentName = getUniqueAttachmentName({
        baseName: path.basename(mediaPath),
        existingNames: attachmentNames
      })
      attachmentNames.add(attachmentName)

      await database.createAttachment({
        actorId,
        statusId,
        mediaType: storedMedia.mime_type,
        url: storedMedia.url,
        width: storedMedia.meta.original.width,
        height: storedMedia.meta.original.height,
        name: attachmentName,
        mediaId: storedMedia.id
      })
    } catch (error) {
      const nodeError = error as Error
      logger.warn({
        message: 'Failed to attach Strava archive media',
        actorId,
        archiveId,
        activityId: activity.activityId,
        mediaPath,
        error: nodeError.message
      })
    }
  }
}

export const importStravaArchiveJob = createJobHandle(
  IMPORT_STRAVA_ARCHIVE_JOB_NAME,
  async (database, message) => {
    const {
      actorId,
      archiveId,
      archiveFitnessFileId,
      batchId,
      visibility,
      nextActivityIndex,
      pendingMediaActivities,
      mediaAttachmentRetry,
      totalActivitiesCount,
      completedActivitiesCount,
      failedActivitiesCount,
      firstFailureMessage
    } = JobData.parse(message.data)

    const [actor, archiveFitnessFile] = await Promise.all([
      database.getActorFromId({ id: actorId }),
      database.getFitnessFile({ id: archiveFitnessFileId })
    ])

    if (!archiveFitnessFile || archiveFitnessFile.actorId !== actorId) {
      logger.warn({
        message: 'Strava archive import skipped due to missing archive file',
        actorId,
        archiveId,
        archiveFitnessFileId
      })
      return
    }

    if (!actor) {
      logger.warn({
        message: 'Strava archive import skipped due to missing actor',
        actorId,
        archiveId,
        archiveFitnessFileId
      })

      const deletedArchive = await deleteFitnessFile(
        database,
        archiveFitnessFile.id,
        archiveFitnessFile
      )
      if (!deletedArchive) {
        logger.error({
          message:
            'Failed to cleanup Strava archive source file for missing actor',
          actorId,
          archiveId,
          archiveFitnessFileId
        })
      }
      return
    }

    await database.updateFitnessFileProcessingStatus(
      archiveFitnessFile.id,
      'processing'
    )

    let archiveReader: StravaArchiveReader | null = null
    let cleanupArchivePath = async () => {}
    let shouldDeleteArchiveSource = true
    let importFailureMessage = firstFailureMessage ?? null
    let importedActivities = completedActivitiesCount
    let failedActivities = failedActivitiesCount
    let pendingActivities = 0
    const runtimeDeadlineMs =
      Date.now() + MAX_IMPORT_JOB_RUNTIME_MS - IMPORT_JOB_REQUEUE_BUFFER_MS

    try {
      const { archiveFilePath, cleanup } = await resolveArchivePath(
        archiveFitnessFile.path,
        archiveFitnessFile.id
      )
      cleanupArchivePath = cleanup

      archiveReader = await StravaArchiveReader.open(archiveFilePath)
      const archiveActivities = await archiveReader.getActivities()
      const targetTotalActivities =
        totalActivitiesCount ?? archiveActivities.length

      const savedArchiveActivities: Array<{
        activity: StravaArchiveActivity
        fitnessFileId: string
      }> = []
      const initialMediaActivities = pendingMediaActivities ?? []
      const effectiveNextActivityIndex =
        nextActivityIndex > 0
          ? nextActivityIndex
          : initialMediaActivities.length > 0
            ? (totalActivitiesCount ?? Number.MAX_SAFE_INTEGER)
            : 0
      let nextArchiveActivityIndex = Math.min(
        effectiveNextActivityIndex,
        archiveActivities.length
      )

      for (
        let activityIndex = nextArchiveActivityIndex;
        activityIndex < archiveActivities.length;
        activityIndex += 1
      ) {
        if (hasReachedRuntimeDeadline(runtimeDeadlineMs)) {
          nextArchiveActivityIndex = activityIndex
          break
        }

        const archiveActivity = archiveActivities[activityIndex]
        nextArchiveActivityIndex = activityIndex + 1

        try {
          const fitnessArchiveBuffer = await archiveReader.readEntryBuffer(
            archiveActivity.fitnessFilePath
          )
          if (!fitnessArchiveBuffer) {
            throw new Error('Fitness activity file is missing from archive')
          }

          const fitnessPayload = toStravaArchiveFitnessFilePayload({
            fitnessFilePath: archiveActivity.fitnessFilePath,
            buffer: fitnessArchiveBuffer
          })

          const fitnessFile = new File(
            [new Uint8Array(fitnessPayload.buffer)],
            fitnessPayload.fileName,
            { type: fitnessPayload.mimeType }
          )

          const savedFitnessFile = await saveFitnessFile(database, actor, {
            file: fitnessFile,
            importBatchId: batchId,
            description:
              archiveActivity.activityDescription ||
              archiveActivity.activityName
          })
          if (!savedFitnessFile) {
            throw new Error('Failed to save imported fitness file from archive')
          }

          savedArchiveActivities.push({
            activity: archiveActivity,
            fitnessFileId: savedFitnessFile.id
          })
        } catch (error) {
          const nodeError = error as Error
          failedActivities += 1
          if (!importFailureMessage) {
            importFailureMessage = nodeError.message
          }
          logger.warn({
            message: 'Failed to import activity from Strava archive',
            actorId,
            archiveId,
            activityId: archiveActivity.activityId,
            fitnessFilePath: archiveActivity.fitnessFilePath,
            error: nodeError.message
          })
        }
      }

      if (savedArchiveActivities.length > 0) {
        await getQueue().publish({
          id: getHashFromString(
            `${actorId}:strava-archive:${archiveId}:import-fitness-files:${nextArchiveActivityIndex}`
          ),
          name: IMPORT_FITNESS_FILES_JOB_NAME,
          data: {
            actorId,
            batchId,
            fitnessFileIds: savedArchiveActivities.map(
              ({ fitnessFileId }) => fitnessFileId
            ),
            overlapFitnessFileIds: [],
            visibility
          }
        })
      }

      const mediaActivities = [
        ...initialMediaActivities,
        ...savedArchiveActivities.map(({ activity, fitnessFileId }) => ({
          fitnessFileId,
          activityId: activity.activityId,
          ...(activity.activityName
            ? { activityName: activity.activityName }
            : null),
          mediaPaths: activity.mediaPaths
        }))
      ]

      if (nextArchiveActivityIndex < archiveActivities.length) {
        await getQueue().publish({
          id: getHashFromString(
            `${actorId}:strava-archive:${archiveId}:continue:${message.id}:import:${nextArchiveActivityIndex}`
          ),
          name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
          data: {
            actorId,
            archiveId,
            archiveFitnessFileId,
            batchId,
            visibility,
            nextActivityIndex: nextArchiveActivityIndex,
            pendingMediaActivities: mediaActivities,
            mediaAttachmentRetry: 0,
            totalActivitiesCount: targetTotalActivities,
            completedActivitiesCount: importedActivities,
            failedActivitiesCount: failedActivities,
            ...(importFailureMessage
              ? { firstFailureMessage: importFailureMessage }
              : null)
          }
        })

        shouldDeleteArchiveSource = false
        await database.updateFitnessFileImportStatus(
          archiveFitnessFile.id,
          'pending',
          `Continuing Strava archive import from activity ${nextArchiveActivityIndex + 1}/${archiveActivities.length}`
        )
        return
      }

      const isMediaRetryPass = mediaAttachmentRetry > 0

      if (mediaActivities.length > 0) {
        if (isMediaRetryPass && MEDIA_ATTACHMENT_RETRY_DELAY_MS > 0) {
          await sleep(MEDIA_ATTACHMENT_RETRY_DELAY_MS)
        }

        const importedFitnessFiles = await getImportedFitnessFiles({
          database,
          fitnessFileIds: mediaActivities.map(
            ({ fitnessFileId }) => fitnessFileId
          )
        })

        const stillPendingMediaActivities: typeof mediaActivities = []
        let hasPendingImportedStatuses = false

        for (
          let activityIndex = 0;
          activityIndex < mediaActivities.length;
          activityIndex += 1
        ) {
          if (hasReachedRuntimeDeadline(runtimeDeadlineMs)) {
            stillPendingMediaActivities.push(
              ...mediaActivities.slice(activityIndex)
            )
            break
          }

          const mediaActivity = mediaActivities[activityIndex]
          const importedFitnessFile = importedFitnessFiles.get(
            mediaActivity.fitnessFileId
          )

          if (!importedFitnessFile?.statusId) {
            if (importedFitnessFile?.importStatus === 'failed') {
              failedActivities += 1
              if (!importFailureMessage) {
                importFailureMessage =
                  importedFitnessFile.importError ||
                  'Imported archive fitness file failed during processing'
              }
            } else {
              stillPendingMediaActivities.push(mediaActivity)
              hasPendingImportedStatuses = true
            }

            logger.warn({
              message:
                'Imported Strava archive fitness file has no status in attachment pass',
              actorId,
              archiveId,
              activityId: mediaActivity.activityId,
              fitnessFileId: mediaActivity.fitnessFileId,
              importStatus: importedFitnessFile?.importStatus
            })
            continue
          }

          await attachActivityMediaToStatus({
            database,
            actor,
            actorId,
            statusId: importedFitnessFile.statusId,
            activity: {
              activityId: mediaActivity.activityId,
              activityName: mediaActivity.activityName,
              mediaPaths: mediaActivity.mediaPaths
            },
            archiveReader,
            archiveId
          })
          importedActivities += 1
        }

        if (stillPendingMediaActivities.length > 0) {
          if (hasPendingImportedStatuses) {
            if (mediaAttachmentRetry < MAX_MEDIA_ATTACHMENT_RETRIES) {
              await getQueue().publish({
                id: getHashFromString(
                  `${actorId}:strava-archive:${archiveId}:continue:${message.id}:media-retry:${mediaAttachmentRetry + 1}`
                ),
                name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
                data: {
                  actorId,
                  archiveId,
                  archiveFitnessFileId,
                  batchId,
                  visibility,
                  pendingMediaActivities: stillPendingMediaActivities,
                  mediaAttachmentRetry: mediaAttachmentRetry + 1,
                  totalActivitiesCount: targetTotalActivities,
                  completedActivitiesCount: importedActivities,
                  failedActivitiesCount: failedActivities,
                  nextActivityIndex: nextArchiveActivityIndex,
                  ...(importFailureMessage
                    ? { firstFailureMessage: importFailureMessage }
                    : null)
                }
              })

              // Keep archive source until the queued retry can attach remaining
              // media entries.
              shouldDeleteArchiveSource = false
              await database.updateFitnessFileImportStatus(
                archiveFitnessFile.id,
                'pending',
                `Waiting for imported statuses before attaching archive media (${stillPendingMediaActivities.length} remaining)`
              )
              return
            }

            // Retries are bounded; once exhausted we fail remaining media
            // activities and allow archive cleanup in finally.
            pendingActivities = stillPendingMediaActivities.length
            failedActivities += stillPendingMediaActivities.length
            if (!importFailureMessage) {
              importFailureMessage =
                'Timed out waiting for imported statuses to attach archive media'
            }
          } else {
            await getQueue().publish({
              id: getHashFromString(
                `${actorId}:strava-archive:${archiveId}:continue:${message.id}:media:${stillPendingMediaActivities.length}`
              ),
              name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
              data: {
                actorId,
                archiveId,
                archiveFitnessFileId,
                batchId,
                visibility,
                pendingMediaActivities: stillPendingMediaActivities,
                mediaAttachmentRetry,
                totalActivitiesCount: targetTotalActivities,
                completedActivitiesCount: importedActivities,
                failedActivitiesCount: failedActivities,
                nextActivityIndex: nextArchiveActivityIndex,
                ...(importFailureMessage
                  ? { firstFailureMessage: importFailureMessage }
                  : null)
              }
            })

            shouldDeleteArchiveSource = false
            await database.updateFitnessFileImportStatus(
              archiveFitnessFile.id,
              'pending',
              `Continuing Strava archive media attachment (${stillPendingMediaActivities.length} remaining)`
            )
            return
          }
        }
      }

      const totalActivities = targetTotalActivities ?? importedActivities
      const summaryParts = [
        `Imported ${importedActivities}/${totalActivities} activities`
      ]
      if (pendingActivities > 0) {
        summaryParts.push(`${pendingActivities} pending`)
      }
      if (failedActivities > 0) {
        summaryParts.push(`${failedActivities} failed`)
      }
      const summary = summaryParts.join(', ')
      const hasFailures = failedActivities > 0 || pendingActivities > 0

      await Promise.all([
        database.updateFitnessFileImportStatus(
          archiveFitnessFile.id,
          hasFailures ? 'failed' : 'completed',
          hasFailures
            ? `${summary}${importFailureMessage ? `: ${importFailureMessage}` : ''}`
            : summary
        ),
        database.updateFitnessFileProcessingStatus(
          archiveFitnessFile.id,
          hasFailures ? 'failed' : 'completed'
        )
      ])
    } catch (error) {
      const nodeError = error as Error
      logger.error({
        message: 'Failed to process Strava archive import job',
        actorId,
        archiveId,
        archiveFitnessFileId,
        error: nodeError.message
      })

      await Promise.all([
        database.updateFitnessFileImportStatus(
          archiveFitnessFile.id,
          'failed',
          nodeError.message
        ),
        database.updateFitnessFileProcessingStatus(
          archiveFitnessFile.id,
          'failed'
        )
      ])
    } finally {
      if (archiveReader) {
        archiveReader.close()
      }

      await cleanupArchivePath()

      if (shouldDeleteArchiveSource) {
        const deletedArchive = await deleteFitnessFile(
          database,
          archiveFitnessFile.id,
          archiveFitnessFile
        )
        if (!deletedArchive) {
          logger.error({
            message: 'Failed to cleanup Strava archive source file',
            actorId,
            archiveId,
            archiveFitnessFileId
          })
        }
      }
    }
  }
)

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
  importId: z.string(),
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

  let attachedMediaCount = 0
  for (const mediaPath of activity.mediaPaths) {
    if (attachedMediaCount >= remainingSlots) {
      break
    }

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
      attachedMediaCount += 1
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

type StravaArchiveJobData = z.infer<typeof JobData>
type StravaArchiveJobCheckpoint = Pick<
  StravaArchiveJobData,
  | 'nextActivityIndex'
  | 'pendingMediaActivities'
  | 'mediaAttachmentRetry'
  | 'totalActivitiesCount'
  | 'completedActivitiesCount'
  | 'failedActivitiesCount'
  | 'firstFailureMessage'
>

const queueStravaArchiveContinuation = async ({
  messageId,
  importId,
  actorId,
  archiveId,
  archiveFitnessFileId,
  batchId,
  visibility,
  checkpoint,
  continuationType
}: {
  messageId: string
  importId: string
  actorId: string
  archiveId: string
  archiveFitnessFileId: string
  batchId: string
  visibility: z.infer<typeof Visibility>
  checkpoint: StravaArchiveJobCheckpoint
  continuationType: string
}) => {
  await getQueue().publish({
    id: getHashFromString(
      `${actorId}:strava-archive:${archiveId}:continue:${messageId}:${continuationType}:import:${checkpoint.nextActivityIndex}:retry:${checkpoint.mediaAttachmentRetry}`
    ),
    name: IMPORT_STRAVA_ARCHIVE_JOB_NAME,
    data: {
      importId,
      actorId,
      archiveId,
      archiveFitnessFileId,
      batchId,
      visibility,
      nextActivityIndex: checkpoint.nextActivityIndex,
      pendingMediaActivities: checkpoint.pendingMediaActivities ?? [],
      mediaAttachmentRetry: checkpoint.mediaAttachmentRetry,
      ...(checkpoint.totalActivitiesCount !== undefined
        ? { totalActivitiesCount: checkpoint.totalActivitiesCount }
        : null),
      completedActivitiesCount: checkpoint.completedActivitiesCount,
      failedActivitiesCount: checkpoint.failedActivitiesCount,
      ...(checkpoint.firstFailureMessage
        ? { firstFailureMessage: checkpoint.firstFailureMessage }
        : null)
    }
  })
}

const updateImportCheckpoint = async ({
  database,
  importId,
  checkpoint,
  status,
  lastError,
  resolvedAt
}: {
  database: Database
  importId: string
  checkpoint: StravaArchiveJobCheckpoint
  status?: 'importing' | 'failed' | 'completed' | 'cancelled'
  lastError?: string | null
  resolvedAt?: number | null
}) => {
  await database.updateStravaArchiveImport({
    id: importId,
    ...(status ? { status } : null),
    nextActivityIndex: checkpoint.nextActivityIndex,
    pendingMediaActivities: checkpoint.pendingMediaActivities ?? [],
    mediaAttachmentRetry: checkpoint.mediaAttachmentRetry,
    ...(checkpoint.totalActivitiesCount !== undefined
      ? { totalActivitiesCount: checkpoint.totalActivitiesCount }
      : null),
    completedActivitiesCount: checkpoint.completedActivitiesCount,
    failedActivitiesCount: checkpoint.failedActivitiesCount,
    firstFailureMessage: checkpoint.firstFailureMessage ?? null,
    ...(lastError !== undefined ? { lastError } : null),
    ...(resolvedAt !== undefined ? { resolvedAt } : null)
  })
}

export const importStravaArchiveJob = createJobHandle(
  IMPORT_STRAVA_ARCHIVE_JOB_NAME,
  async (database, message) => {
    const {
      importId,
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

    const activeImport = await database.getStravaArchiveImportById({
      id: importId
    })
    if (
      !activeImport ||
      activeImport.actorId !== actorId ||
      activeImport.archiveId !== archiveId
    ) {
      logger.warn({
        message: 'Skipping Strava archive import due to missing import state',
        importId,
        actorId,
        archiveId
      })
      return
    }

    if (activeImport.status !== 'importing' || activeImport.resolvedAt) {
      logger.info({
        message: 'Skipping Strava archive import because import is not active',
        importId,
        actorId,
        archiveId,
        status: activeImport.status
      })
      return
    }

    const [actor, archiveFitnessFile] = await Promise.all([
      database.getActorFromId({ id: actorId }),
      database.getFitnessFile({ id: archiveFitnessFileId })
    ])

    if (!archiveFitnessFile || archiveFitnessFile.actorId !== actorId) {
      logger.warn({
        message: 'Strava archive import skipped due to missing archive file',
        importId,
        actorId,
        archiveId,
        archiveFitnessFileId
      })
      await database.updateStravaArchiveImport({
        id: importId,
        status: 'cancelled',
        lastError: 'Archive source file is missing',
        resolvedAt: Date.now()
      })
      return
    }

    if (!actor) {
      logger.warn({
        message: 'Strava archive import skipped due to missing actor',
        importId,
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
          importId,
          actorId,
          archiveId,
          archiveFitnessFileId
        })
      }
      await database.updateStravaArchiveImport({
        id: importId,
        status: 'cancelled',
        lastError: 'Actor no longer exists',
        resolvedAt: Date.now()
      })
      return
    }

    await Promise.all([
      database.updateFitnessFileProcessingStatus(
        archiveFitnessFile.id,
        'processing'
      ),
      database.updateStravaArchiveImport({
        id: importId,
        status: 'importing',
        archiveFitnessFileId: archiveFitnessFile.id,
        lastError: null
      })
    ])

    let archiveReader: StravaArchiveReader | null = null
    let cleanupArchivePath = async () => {}
    let shouldDeleteArchiveSource = true
    let shouldMarkImportCompleted = false
    let importFailureMessage =
      activeImport.firstFailureMessage ?? firstFailureMessage ?? null
    let importedActivities = Math.max(
      completedActivitiesCount,
      activeImport.completedActivitiesCount
    )
    let failedActivities = Math.max(
      failedActivitiesCount,
      activeImport.failedActivitiesCount
    )
    let pendingActivities = 0
    const initialPendingMediaActivities =
      activeImport.pendingMediaActivities.length > 0
        ? activeImport.pendingMediaActivities
        : (pendingMediaActivities ?? [])
    let checkpoint: StravaArchiveJobCheckpoint = {
      nextActivityIndex: Math.max(
        nextActivityIndex,
        activeImport.nextActivityIndex
      ),
      pendingMediaActivities: initialPendingMediaActivities,
      mediaAttachmentRetry: Math.max(
        mediaAttachmentRetry,
        activeImport.mediaAttachmentRetry
      ),
      totalActivitiesCount:
        activeImport.totalActivitiesCount ?? totalActivitiesCount,
      completedActivitiesCount: importedActivities,
      failedActivitiesCount: failedActivities,
      ...(importFailureMessage
        ? { firstFailureMessage: importFailureMessage }
        : null)
    }
    const setCheckpoint = (next: Partial<StravaArchiveJobCheckpoint>) => {
      checkpoint = {
        ...checkpoint,
        ...next
      }
    }
    const runtimeDeadlineMs =
      Date.now() + MAX_IMPORT_JOB_RUNTIME_MS - IMPORT_JOB_REQUEUE_BUFFER_MS

    const isImportStillActive = async () => {
      const importState = await database.getStravaArchiveImportById({
        id: importId
      })
      return Boolean(
        importState &&
        importState.status === 'importing' &&
        !importState.resolvedAt
      )
    }

    try {
      const { archiveFilePath, cleanup } = await resolveArchivePath(
        archiveFitnessFile.path,
        archiveFitnessFile.id
      )
      cleanupArchivePath = cleanup

      archiveReader = await StravaArchiveReader.open(archiveFilePath)
      const archiveActivities = await archiveReader.getActivities()
      const targetTotalActivities =
        checkpoint.totalActivitiesCount ?? archiveActivities.length
      setCheckpoint({
        totalActivitiesCount: targetTotalActivities
      })

      const savedArchiveActivities: Array<{
        activity: StravaArchiveActivity
        fitnessFileId: string
      }> = []
      const initialMediaActivities = checkpoint.pendingMediaActivities ?? []
      const effectiveNextActivityIndex =
        checkpoint.nextActivityIndex > 0
          ? checkpoint.nextActivityIndex
          : initialMediaActivities.length > 0
            ? targetTotalActivities
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
        if (!(await isImportStillActive())) {
          shouldDeleteArchiveSource = false
          return
        }

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
        const savedFitnessFileIds = savedArchiveActivities.map(
          ({ fitnessFileId }) => fitnessFileId
        )
        try {
          await getQueue().publish({
            id: getHashFromString(
              `${actorId}:strava-archive:${archiveId}:import-fitness-files:${nextArchiveActivityIndex}`
            ),
            name: IMPORT_FITNESS_FILES_JOB_NAME,
            data: {
              actorId,
              batchId,
              fitnessFileIds: savedFitnessFileIds,
              overlapFitnessFileIds: [],
              visibility
            }
          })
        } catch (error) {
          const rollbackResults = await Promise.all(
            savedFitnessFileIds.map(async (fitnessFileId) => {
              try {
                const deleted = await deleteFitnessFile(database, fitnessFileId)
                return {
                  fitnessFileId,
                  deleted
                }
              } catch {
                return {
                  fitnessFileId,
                  deleted: false
                }
              }
            })
          )
          const rollbackFailures = rollbackResults
            .filter((result) => !result.deleted)
            .map((result) => result.fitnessFileId)
          if (rollbackFailures.length > 0) {
            logger.error({
              message:
                'Failed to rollback staged Strava archive fitness files after queue publish failure',
              actorId,
              archiveId,
              importId,
              rollbackFailures
            })
          }
          throw error
        }
      }

      let mediaActivities = [
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
      const nextMediaAttachmentRetry =
        savedArchiveActivities.length > 0 ? 0 : checkpoint.mediaAttachmentRetry
      setCheckpoint({
        pendingMediaActivities: mediaActivities,
        nextActivityIndex: nextArchiveActivityIndex,
        mediaAttachmentRetry: nextMediaAttachmentRetry,
        completedActivitiesCount: importedActivities,
        failedActivitiesCount: failedActivities,
        ...(importFailureMessage
          ? { firstFailureMessage: importFailureMessage }
          : null)
      })

      if (nextArchiveActivityIndex < archiveActivities.length) {
        await updateImportCheckpoint({
          database,
          importId,
          checkpoint,
          status: 'importing',
          lastError: null
        })
        await queueStravaArchiveContinuation({
          messageId: message.id,
          importId,
          actorId,
          archiveId,
          archiveFitnessFileId,
          batchId,
          visibility,
          checkpoint,
          continuationType: 'import'
        })

        shouldDeleteArchiveSource = false
        await database.updateFitnessFileImportStatus(
          archiveFitnessFile.id,
          'pending',
          `Continuing Strava archive import from activity ${nextArchiveActivityIndex + 1}/${archiveActivities.length}`
        )
        return
      }

      const currentMediaAttachmentRetry = checkpoint.mediaAttachmentRetry
      const isMediaRetryPass = currentMediaAttachmentRetry > 0

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
          if (!(await isImportStillActive())) {
            shouldDeleteArchiveSource = false
            return
          }

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

        mediaActivities = stillPendingMediaActivities

        if (stillPendingMediaActivities.length > 0) {
          if (hasPendingImportedStatuses) {
            if (currentMediaAttachmentRetry < MAX_MEDIA_ATTACHMENT_RETRIES) {
              setCheckpoint({
                pendingMediaActivities: stillPendingMediaActivities,
                mediaAttachmentRetry: currentMediaAttachmentRetry + 1,
                nextActivityIndex: nextArchiveActivityIndex,
                completedActivitiesCount: importedActivities,
                failedActivitiesCount: failedActivities,
                ...(importFailureMessage
                  ? { firstFailureMessage: importFailureMessage }
                  : null)
              })
              await updateImportCheckpoint({
                database,
                importId,
                checkpoint,
                status: 'importing',
                lastError: null
              })
              await queueStravaArchiveContinuation({
                messageId: message.id,
                importId,
                actorId,
                archiveId,
                archiveFitnessFileId,
                batchId,
                visibility,
                checkpoint,
                continuationType: 'media-retry'
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

            // Retries are bounded; once exhausted we fail the import and keep
            // archive source for explicit retry/cancel.
            pendingActivities = stillPendingMediaActivities.length
            failedActivities += stillPendingMediaActivities.length
            if (!importFailureMessage) {
              importFailureMessage =
                'Timed out waiting for imported statuses to attach archive media'
            }
            setCheckpoint({
              pendingMediaActivities: stillPendingMediaActivities,
              completedActivitiesCount: importedActivities,
              failedActivitiesCount: failedActivities,
              ...(importFailureMessage
                ? { firstFailureMessage: importFailureMessage }
                : null)
            })
            throw new Error(importFailureMessage)
          } else {
            setCheckpoint({
              pendingMediaActivities: stillPendingMediaActivities,
              mediaAttachmentRetry: currentMediaAttachmentRetry,
              nextActivityIndex: nextArchiveActivityIndex,
              completedActivitiesCount: importedActivities,
              failedActivitiesCount: failedActivities,
              ...(importFailureMessage
                ? { firstFailureMessage: importFailureMessage }
                : null)
            })
            await updateImportCheckpoint({
              database,
              importId,
              checkpoint,
              status: 'importing',
              lastError: null
            })
            await queueStravaArchiveContinuation({
              messageId: message.id,
              importId,
              actorId,
              archiveId,
              archiveFitnessFileId,
              batchId,
              visibility,
              checkpoint,
              continuationType: 'media'
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

      setCheckpoint({
        pendingMediaActivities: mediaActivities,
        nextActivityIndex: targetTotalActivities,
        mediaAttachmentRetry:
          hasFailures && pendingActivities > 0
            ? currentMediaAttachmentRetry
            : 0,
        completedActivitiesCount: importedActivities,
        failedActivitiesCount: failedActivities,
        ...(importFailureMessage
          ? { firstFailureMessage: importFailureMessage }
          : null)
      })

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
      shouldMarkImportCompleted = true
    } catch (error) {
      const nodeError = error as Error
      logger.error({
        message: 'Failed to process Strava archive import job',
        importId,
        actorId,
        archiveId,
        archiveFitnessFileId,
        error: nodeError.message
      })

      shouldDeleteArchiveSource = false
      setCheckpoint({
        completedActivitiesCount: importedActivities,
        failedActivitiesCount: failedActivities,
        ...(importFailureMessage
          ? { firstFailureMessage: importFailureMessage }
          : null)
      })

      await updateImportCheckpoint({
        database,
        importId,
        checkpoint,
        status: 'failed',
        lastError: nodeError.message,
        resolvedAt: null
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

      let archiveCleanupFailed = false
      if (shouldDeleteArchiveSource) {
        const deletedArchive = await deleteFitnessFile(
          database,
          archiveFitnessFile.id,
          archiveFitnessFile
        )
        if (!deletedArchive) {
          archiveCleanupFailed = true
          logger.error({
            message: 'Failed to cleanup Strava archive source file',
            importId,
            actorId,
            archiveId,
            archiveFitnessFileId
          })
          if (shouldMarkImportCompleted) {
            await updateImportCheckpoint({
              database,
              importId,
              checkpoint,
              status: 'failed',
              lastError: 'Failed to cleanup Strava archive source file',
              resolvedAt: null
            })
            await Promise.all([
              database.updateFitnessFileImportStatus(
                archiveFitnessFile.id,
                'failed',
                'Failed to cleanup Strava archive source file'
              ),
              database.updateFitnessFileProcessingStatus(
                archiveFitnessFile.id,
                'failed'
              )
            ])
          }
        }
      }

      if (shouldMarkImportCompleted && !archiveCleanupFailed) {
        await updateImportCheckpoint({
          database,
          importId,
          checkpoint,
          status: 'completed',
          lastError: null,
          resolvedAt: Date.now()
        })
      }
    }
  }
)

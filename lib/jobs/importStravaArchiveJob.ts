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

const JobData = z.object({
  actorId: z.string(),
  archiveId: z.string(),
  archiveFitnessFileId: z.string(),
  batchId: z.string(),
  visibility: Visibility.default('public')
})

const ATTACHMENT_FILE_NAME_LIMIT = 150
const FITNESS_IMPORT_WAIT_INTERVAL_MS = 1_000
const FITNESS_IMPORT_WAIT_TIMEOUT_MS = 120_000

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

const waitForImportedFitnessFiles = async ({
  database,
  fitnessFileIds,
  timeoutMs = FITNESS_IMPORT_WAIT_TIMEOUT_MS,
  intervalMs = FITNESS_IMPORT_WAIT_INTERVAL_MS
}: {
  database: Database
  fitnessFileIds: string[]
  timeoutMs?: number
  intervalMs?: number
}) => {
  const completedFiles = new Map<
    string,
    {
      statusId?: string | null
      importStatus?: 'pending' | 'completed' | 'failed'
      importError?: string
    }
  >()
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    const files = await database.getFitnessFilesByIds({
      fitnessFileIds
    })

    completedFiles.clear()
    for (const file of files) {
      completedFiles.set(file.id, {
        statusId: file.statusId,
        importStatus: file.importStatus,
        importError: file.importError
      })
    }

    const unresolvedCount = fitnessFileIds.filter((fitnessFileId) => {
      const fitnessFile = completedFiles.get(fitnessFileId)
      if (!fitnessFile) {
        return true
      }

      if (fitnessFile.statusId) {
        return false
      }

      return fitnessFile.importStatus !== 'failed'
    }).length

    if (unresolvedCount === 0) {
      return completedFiles
    }

    await sleep(intervalMs)
  }

  return completedFiles
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
  activity: StravaArchiveActivity
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
    const { actorId, archiveId, archiveFitnessFileId, batchId, visibility } =
      JobData.parse(message.data)

    const [actor, archiveFitnessFile] = await Promise.all([
      database.getActorFromId({ id: actorId }),
      database.getFitnessFile({ id: archiveFitnessFileId })
    ])

    if (
      !actor ||
      !archiveFitnessFile ||
      archiveFitnessFile.actorId !== actorId
    ) {
      logger.warn({
        message:
          'Strava archive import skipped due to missing actor or archive file',
        actorId,
        archiveId,
        archiveFitnessFileId
      })
      return
    }

    await database.updateFitnessFileProcessingStatus(
      archiveFitnessFile.id,
      'processing'
    )

    let archiveReader: StravaArchiveReader | null = null
    let cleanupArchivePath = async () => {}
    let firstFailureMessage: string | null = null
    let importedActivities = 0
    let pendingActivities = 0
    let failedActivities = 0

    try {
      const { archiveFilePath, cleanup } = await resolveArchivePath(
        archiveFitnessFile.path,
        archiveFitnessFile.id
      )
      cleanupArchivePath = cleanup

      archiveReader = await StravaArchiveReader.open(archiveFilePath)
      const archiveActivities = await archiveReader.getActivities()
      const totalActivities = archiveActivities.length
      const savedArchiveActivities: Array<{
        activity: StravaArchiveActivity
        fitnessFileId: string
      }> = []

      for (const archiveActivity of archiveActivities) {
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
          if (!firstFailureMessage) {
            firstFailureMessage = nodeError.message
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
            `${actorId}:strava-archive:${archiveId}:import-fitness-files`
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

        const importedFitnessFiles = await waitForImportedFitnessFiles({
          database,
          fitnessFileIds: savedArchiveActivities.map(
            ({ fitnessFileId }) => fitnessFileId
          )
        })

        for (const {
          activity: archiveActivity,
          fitnessFileId
        } of savedArchiveActivities) {
          const importedFitnessFile = importedFitnessFiles.get(fitnessFileId)

          if (!importedFitnessFile?.statusId) {
            if (importedFitnessFile?.importStatus === 'failed') {
              failedActivities += 1
              if (!firstFailureMessage) {
                firstFailureMessage =
                  importedFitnessFile.importError ||
                  'Imported archive fitness file failed during processing'
              }
            } else {
              pendingActivities += 1
            }

            logger.warn({
              message:
                'Imported Strava archive fitness file has no status after import wait',
              actorId,
              archiveId,
              activityId: archiveActivity.activityId,
              fitnessFileId,
              importStatus: importedFitnessFile?.importStatus
            })
            continue
          }

          await attachActivityMediaToStatus({
            database,
            actor,
            actorId,
            statusId: importedFitnessFile.statusId,
            activity: archiveActivity,
            archiveReader,
            archiveId
          })
          importedActivities += 1
        }
      }

      const summaryParts = [`Imported ${importedActivities}/${totalActivities}`]
      if (pendingActivities > 0) {
        summaryParts.push(`${pendingActivities} pending`)
      }
      if (failedActivities > 0) {
        summaryParts.push(`${failedActivities} failed`)
      }
      const summary = summaryParts.join(', ')

      await Promise.all([
        database.updateFitnessFileImportStatus(
          archiveFitnessFile.id,
          failedActivities > 0 ? 'failed' : 'completed',
          failedActivities > 0
            ? `${summary}${firstFailureMessage ? `: ${firstFailureMessage}` : ''}`
            : summary
        ),
        database.updateFitnessFileProcessingStatus(
          archiveFitnessFile.id,
          failedActivities > 0 ? 'failed' : 'completed'
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
)

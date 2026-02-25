import { z } from 'zod'

import { Database } from '@/lib/database/types'
import {
  REGENERATE_FITNESS_MAPS_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { generateMapImage } from '@/lib/services/fitness-files/generateMapImage'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import {
  getFitnessPrivacyLocations,
  getVisibleSegments
} from '@/lib/services/fitness-files/privacy'
import { deleteMediaFile, saveMedia } from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { StatusType } from '@/lib/types/domain/status'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'

const JobData = z.object({
  actorId: z.string(),
  fitnessFileIds: z.array(z.string()).min(1)
})

const getFitnessFileBuffer = async (
  database: Database,
  fitnessFileId: string
): Promise<Buffer> => {
  const data = await getFitnessFile(database, fitnessFileId)
  if (!data) {
    throw new Error('Fitness file not found in storage')
  }

  if (data.type === 'buffer') {
    return data.buffer
  }

  const response = await fetch(data.redirectUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to download fitness file from redirect URL (${response.status})`
    )
  }

  return Buffer.from(await response.arrayBuffer())
}

const removeOldMapAttachmentsAndMedia = async ({
  database,
  accountId,
  statusId,
  oldAttachmentIds,
  oldMediaIds
}: {
  database: Database
  accountId: string
  statusId: string
  oldAttachmentIds: string[]
  oldMediaIds: string[]
}) => {
  if (oldAttachmentIds.length > 0) {
    await database.deleteAttachmentsByIds({
      attachmentIds: oldAttachmentIds
    })
  }

  for (const mediaId of oldMediaIds) {
    const media = await database.getMediaByIdForAccount({
      mediaId,
      accountId
    })

    if (media) {
      const filePaths = [
        media.original.path,
        ...(media.thumbnail ? [media.thumbnail.path] : [])
      ]

      const deletionResults = await Promise.allSettled(
        filePaths.map((path) => deleteMediaFile(database, path))
      )

      deletionResults.forEach((result, index) => {
        if (result.status === 'rejected' || !result.value) {
          logger.warn({
            message: 'Failed to delete legacy map media file from storage',
            statusId,
            mediaId,
            path: filePaths[index]
          })
        }
      })
    }

    const deletedMedia = await database.deleteMedia({ mediaId })
    if (!deletedMedia) {
      logger.warn({
        message: 'Failed to delete legacy map media database record',
        statusId,
        mediaId
      })
    }
  }
}

export const regenerateFitnessMapsJob = createJobHandle(
  REGENERATE_FITNESS_MAPS_JOB_NAME,
  async (database, message) => {
    const { actorId, fitnessFileIds } = JobData.parse(message.data)

    const actor = await database.getActorFromId({ id: actorId })
    if (!actor || !actor.account) {
      logger.error({
        message: 'Failed to regenerate fitness maps: actor not found',
        actorId
      })
      return
    }

    const privacySettings = await database.getFitnessSettings({
      actorId,
      serviceType: 'general'
    })
    const privacyLocation = getFitnessPrivacyLocations(privacySettings)

    const statusesNeedingUpdate = new Set<string>()

    for (const fitnessFileId of fitnessFileIds) {
      try {
        const fitnessFile = await database.getFitnessFile({ id: fitnessFileId })
        if (!fitnessFile) {
          throw new Error('Fitness file not found')
        }

        if (fitnessFile.actorId !== actorId || !fitnessFile.statusId) {
          throw new Error(
            'Fitness file is not linked to the actor or an existing status'
          )
        }

        const statusId = fitnessFile.statusId
        const status = await database.getStatus({
          statusId,
          withReplies: false
        })
        if (!status) {
          throw new Error('Status not found for fitness file')
        }

        const oldMapAttachments = (
          await database.getAttachmentsWithMedia({ statusId })
        ).filter((attachment) => {
          if (attachment.name !== 'Activity route map') {
            return false
          }

          if (!fitnessFile.mapImagePath) {
            return false
          }

          const attachmentPath = getAttachmentMediaPath(attachment.url)
          return attachmentPath === fitnessFile.mapImagePath
        })
        const oldAttachmentIds = oldMapAttachments.map((item) => item.id)
        const oldMediaIds = [
          ...new Set(
            oldMapAttachments
              .map((item) => item.mediaId ?? null)
              .filter((value): value is string => Boolean(value))
          )
        ]

        const fitnessBuffer = await getFitnessFileBuffer(
          database,
          fitnessFileId
        )
        if (!isParseableFitnessFileType(fitnessFile.fileType)) {
          throw new Error(
            `Unsupported fitness file type for map regeneration: ${fitnessFile.fileType}`
          )
        }
        const activityData = await parseFitnessFile({
          fileType: fitnessFile.fileType,
          buffer: fitnessBuffer
        })

        const visibleSegments = getVisibleSegments(
          activityData.coordinates,
          privacyLocation
        )
        const filteredCoordinates = visibleSegments.flat()

        let changedMapAttachment = false

        if (filteredCoordinates.length >= 2) {
          const mapImageBuffer = await generateMapImage({
            coordinates: filteredCoordinates,
            routeSegments: visibleSegments
          })

          if (!mapImageBuffer) {
            throw new Error('Generated map image buffer is empty')
          }

          const mapImageBytes = new Uint8Array(mapImageBuffer)
          const storedMap = await saveMedia(database, actor, {
            file: new File([mapImageBytes], `${fitnessFileId}-route-map.png`, {
              type: 'image/png'
            }),
            description: `${fitnessFile.fileName} route map`
          })

          if (!storedMap) {
            throw new Error('Failed to store generated route map image')
          }

          await database.createAttachment({
            actorId,
            statusId,
            mediaType: storedMap.mime_type,
            url: storedMap.url,
            width: storedMap.meta.original.width,
            height: storedMap.meta.original.height,
            name: 'Activity route map',
            mediaId: storedMap.id
          })

          await database.updateFitnessFileActivityData(fitnessFileId, {
            hasMapData: true,
            mapImagePath: getAttachmentMediaPath(storedMap.url)
          })
          changedMapAttachment = true
        } else {
          await database.updateFitnessFileActivityData(fitnessFileId, {
            hasMapData: false,
            mapImagePath: null
          })
          changedMapAttachment = oldAttachmentIds.length > 0
        }

        await removeOldMapAttachmentsAndMedia({
          database,
          accountId: actor.account.id,
          statusId,
          oldAttachmentIds,
          oldMediaIds
        })

        await database.updateFitnessFileProcessingStatus(
          fitnessFileId,
          'completed'
        )

        if (status.type === StatusType.enum.Note && changedMapAttachment) {
          statusesNeedingUpdate.add(statusId)
        }
      } catch (error) {
        const nodeError = error as Error
        logger.error({
          message: 'Failed to regenerate fitness map for old status',
          actorId,
          fitnessFileId,
          error: nodeError.message
        })

        await database.updateFitnessFileProcessingStatus(
          fitnessFileId,
          'failed'
        )
      }
    }

    await Promise.all(
      [...statusesNeedingUpdate].map((statusId) => {
        return getQueue().publish({
          id: getHashFromString(`${statusId}:send-update-note:fitness-map`),
          name: SEND_UPDATE_NOTE_JOB_NAME,
          data: {
            actorId,
            statusId
          }
        })
      })
    )
  }
)

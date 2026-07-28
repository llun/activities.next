import { z } from 'zod'

import { Database } from '@/lib/database/types'
import {
  REGENERATE_FITNESS_MAPS_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { deleteEmailMapImage } from '@/lib/services/fitness-files/emailMapImage'
import { generateMapImage } from '@/lib/services/fitness-files/generateMapImage'
import { toImportErrorMessage } from '@/lib/services/fitness-files/importError'
import {
  ROUTE_MAP_ATTACHMENT_NAME,
  findRouteMapAttachments,
  getAttachmentMediaIds,
  removeRouteMapAttachmentsAndMedia
} from '@/lib/services/fitness-files/mapAttachments'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import {
  getFitnessPrivacyLocations,
  getVisibleSegments
} from '@/lib/services/fitness-files/privacy'
import { saveMedia } from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { StatusType } from '@/lib/types/domain/status'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

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

        const oldMapAttachments = await findRouteMapAttachments({
          database,
          statusId,
          mapImagePath: fitnessFile.mapImagePath
        })
        const oldAttachmentIds = oldMapAttachments.map((item) => item.id)
        const oldMediaIds = getAttachmentMediaIds(oldMapAttachments)

        // A status carries at most one route map, owned by its primary fitness
        // file. A non-primary file (e.g. the second device of a merged
        // same-ride post) must not contribute its own map, otherwise the post
        // renders duplicate images. Heal such a file by removing any stray map
        // it owns and marking it done, without parsing or regenerating.
        if (fitnessFile.isPrimary === false) {
          // Contained like the other cleanup call: a stray map this file must
          // not own is worth removing, but failing to remove it is not worth
          // marking a fully parsed activity `failed` and hiding it everywhere.
          try {
            await removeRouteMapAttachmentsAndMedia({
              database,
              accountId: actor.account.id,
              statusId,
              attachmentIds: oldAttachmentIds,
              mediaIds: oldMediaIds
            })
          } catch (error) {
            logger.error({
              message: 'Failed to remove a stray route map from a merged post',
              actorId,
              fitnessFileId,
              err: toLoggableError(error)
            })
          }

          await database.updateFitnessFileActivityData(fitnessFileId, {
            hasMapData: false,
            mapImagePath: null,
            mapImageEmailPath: null,
            // This file is not supposed to own a map, so an earlier failure to
            // produce one is not a pending problem.
            mapError: null
          })
          await deleteEmailMapImage({
            database,
            fitnessFileId,
            mapImageEmailPath: fitnessFile.mapImageEmailPath
          })
          await database.updateFitnessFileProcessingStatus(
            fitnessFileId,
            'completed'
          )

          if (
            status.type === StatusType.enum.Note &&
            oldAttachmentIds.length > 0
          ) {
            statusesNeedingUpdate.add(statusId)
          }

          continue
        }

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
        // A map that cannot be rendered or stored is NOT a failed file. The
        // activity is untouched by this job and still fully usable, while
        // `processingStatus: 'failed'` would hide it from the status detail
        // dashboard, the post's stat grid, the fitness overview, the profile's
        // Fitness tab and every stats/heatmap rollup. Record the reason, keep
        // the map the file already had, and leave the file `completed` — the
        // same policy processFitnessFileJob applies on the import path.
        let mapErrorMessage: string | undefined

        if (filteredCoordinates.length >= 2) {
          try {
            const mapImageBuffer = await generateMapImage({
              coordinates: filteredCoordinates,
              routeSegments: visibleSegments
            })

            if (!mapImageBuffer) {
              throw new Error('Generated map image buffer is empty')
            }

            const mapImageBytes = new Uint8Array(mapImageBuffer)
            const storedMap = await saveMedia(database, actor, {
              file: new File(
                [mapImageBytes],
                `${fitnessFileId}-route-map.png`,
                {
                  type: 'image/png'
                }
              ),
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
              name: ROUTE_MAP_ATTACHMENT_NAME,
              mediaId: storedMap.id
            })

            await database.updateFitnessFileActivityData(fitnessFileId, {
              hasMapData: true,
              mapImagePath: getAttachmentMediaPath(storedMap.url),
              mapImageEmailPath: null,
              mapError: null
            })
            changedMapAttachment = true
          } catch (error) {
            mapErrorMessage = toImportErrorMessage(
              error,
              'Unknown route map generation error'
            )
            logger.error({
              message: 'Failed to regenerate route map for fitness activity',
              actorId,
              fitnessFileId,
              error: mapErrorMessage,
              err: toLoggableError(error)
            })
          }
        } else {
          await database.updateFitnessFileActivityData(fitnessFileId, {
            hasMapData: false,
            mapImagePath: null,
            mapImageEmailPath: null,
            mapError: null
          })
          changedMapAttachment = oldAttachmentIds.length > 0
        }

        if (mapErrorMessage) {
          // This run produced no replacement, so the removal below must not
          // run: dropping the old map and its email copy would turn a failed
          // regeneration into data loss. Record the reason and stop here.
          await database.updateFitnessFileActivityData(fitnessFileId, {
            mapError: mapErrorMessage
          })
          await database.updateFitnessFileProcessingStatus(
            fitnessFileId,
            'completed'
          )
          continue
        }

        // Contained: the replacement already exists by now, so a cleanup
        // failure costs a leftover file. Left uncontained it reaches the catch
        // below and marks a regenerated, perfectly usable activity `failed` —
        // hiding it from the detail dashboard, the stat grid, the overview and
        // every rollup — and skips the federated update note as well.
        try {
          // The copy backed an email sent when the activity arrived, so there
          // is nothing to replace it with — and after a privacy change it may
          // show a route the owner has since hidden.
          await deleteEmailMapImage({
            database,
            fitnessFileId,
            mapImageEmailPath: fitnessFile.mapImageEmailPath
          })

          await removeRouteMapAttachmentsAndMedia({
            database,
            accountId: actor.account.id,
            statusId,
            attachmentIds: oldAttachmentIds,
            mediaIds: oldMediaIds
          })
        } catch (error) {
          logger.error({
            message: 'Failed to remove the previous route map',
            actorId,
            fitnessFileId,
            err: toLoggableError(error)
          })
        }

        await database.updateFitnessFileProcessingStatus(
          fitnessFileId,
          'completed'
        )

        if (status.type === StatusType.enum.Note && changedMapAttachment) {
          statusesNeedingUpdate.add(statusId)
        }
      } catch (error) {
        const errorMessage = toImportErrorMessage(
          error,
          'Unknown fitness map regeneration error'
        )
        logger.error({
          message: 'Failed to regenerate fitness map for old status',
          actorId,
          fitnessFileId,
          error: errorMessage,
          err: toLoggableError(error)
        })

        await database.updateFitnessFileProcessingStatus(
          fitnessFileId,
          'failed',
          errorMessage
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

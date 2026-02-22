import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { generateMapImage } from '@/lib/services/fitness-files/generateMapImage'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import {
  getFitnessPrivacyLocation,
  getVisibleSegments
} from '@/lib/services/fitness-files/privacy'
import { saveMedia } from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { StatusType } from '@/lib/types/domain/status'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { PROCESS_FITNESS_FILE_JOB_NAME } from './names'

const JobData = z.object({
  actorId: z.string(),
  statusId: z.string(),
  fitnessFileId: z.string(),
  publishSendNote: z.boolean().optional().default(true)
})

const ACTIVITY_LABELS: Record<string, { label: string; emoji: string }> = {
  run: { label: 'Running', emoji: '🏃' },
  running: { label: 'Running', emoji: '🏃' },
  walk: { label: 'Walking', emoji: '🚶' },
  walking: { label: 'Walking', emoji: '🚶' },
  hike: { label: 'Hiking', emoji: '🥾' },
  hiking: { label: 'Hiking', emoji: '🥾' },
  cycle: { label: 'Cycling', emoji: '🚴' },
  cycling: { label: 'Cycling', emoji: '🚴' },
  bike: { label: 'Cycling', emoji: '🚴' },
  biking: { label: 'Cycling', emoji: '🚴' },
  swim: { label: 'Swimming', emoji: '🏊' },
  swimming: { label: 'Swimming', emoji: '🏊' }
}

const getActivityPresentation = (activityType?: string) => {
  if (!activityType) {
    return { label: 'Workout', emoji: '🏋️' }
  }

  const normalized = activityType.toLowerCase()

  if (ACTIVITY_LABELS[normalized]) {
    return ACTIVITY_LABELS[normalized]
  }

  return {
    label: `${activityType[0].toUpperCase()}${activityType.slice(1)}`,
    emoji: '🏋️'
  }
}

const formatDistance = (distanceMeters: number) => {
  const kilometers = distanceMeters / 1000
  if (kilometers >= 10) {
    return `${kilometers.toFixed(1)} km`
  }

  return `${kilometers.toFixed(2)} km`
}

const formatDuration = (durationSeconds: number) => {
  const totalSeconds = Math.max(0, Math.round(durationSeconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')} hr`
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')} min`
}

const buildActivitySummary = (data: FitnessActivityData): string => {
  const { label, emoji } = getActivityPresentation(data.activityType)

  const base = `${emoji} ${label}`

  if (data.totalDistanceMeters > 0 && data.totalDurationSeconds > 0) {
    return `${base} — ${formatDistance(data.totalDistanceMeters)} in ${formatDuration(data.totalDurationSeconds)}`
  }

  if (data.totalDistanceMeters > 0) {
    return `${base} — ${formatDistance(data.totalDistanceMeters)}`
  }

  if (data.totalDurationSeconds > 0) {
    return `${base} — ${formatDuration(data.totalDurationSeconds)}`
  }

  return base
}

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

export const processFitnessFileJob = createJobHandle(
  PROCESS_FITNESS_FILE_JOB_NAME,
  async (database, message) => {
    const { actorId, statusId, fitnessFileId, publishSendNote } = JobData.parse(
      message.data
    )

    await database.updateFitnessFileProcessingStatus(
      fitnessFileId,
      'processing'
    )

    try {
      const [actor, fitnessFile, status] = await Promise.all([
        database.getActorFromId({ id: actorId }),
        database.getFitnessFile({ id: fitnessFileId }),
        database.getStatus({ statusId, withReplies: false })
      ])

      if (!actor || !fitnessFile || !status) {
        throw new Error('Actor, status, or fitness file was not found')
      }

      if (
        fitnessFile.actorId !== actorId ||
        fitnessFile.statusId !== statusId
      ) {
        throw new Error('Fitness file does not belong to the target status')
      }

      const fitnessBuffer = await getFitnessFileBuffer(database, fitnessFileId)

      const activityData = await parseFitnessFile({
        fileType: fitnessFile.fileType,
        buffer: fitnessBuffer
      })

      await database.updateFitnessFileActivityData(fitnessFileId, {
        totalDistanceMeters: activityData.totalDistanceMeters,
        totalDurationSeconds: activityData.totalDurationSeconds,
        elevationGainMeters: activityData.elevationGainMeters,
        activityType: activityData.activityType,
        activityStartTime: activityData.startTime ?? null,
        hasMapData: false,
        mapImagePath: null
      })

      const privacySettings = await database.getFitnessSettings({
        actorId,
        serviceType: 'general'
      })
      const privacyLocation = getFitnessPrivacyLocation({
        privacyHomeLatitude: privacySettings?.privacyHomeLatitude,
        privacyHomeLongitude: privacySettings?.privacyHomeLongitude,
        privacyHideRadiusMeters: privacySettings?.privacyHideRadiusMeters
      })
      const visibleSegments = getVisibleSegments(
        activityData.coordinates,
        privacyLocation
      )

      const filteredCoordinates = visibleSegments.flat()

      if (filteredCoordinates.length >= 2) {
        try {
          const mapImageBuffer = await generateMapImage({
            coordinates: filteredCoordinates,
            routeSegments: visibleSegments
          })

          if (mapImageBuffer) {
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
              logger.warn({
                message: 'Failed to store generated route map image',
                actorId,
                statusId,
                fitnessFileId
              })
            } else {
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
            }
          }
        } catch (error) {
          const nodeError = error as Error
          logger.warn({
            message: 'Map generation failed; continuing without route map',
            actorId,
            statusId,
            fitnessFileId,
            error: nodeError.message
          })
        }
      }

      if (
        status.type === StatusType.enum.Note &&
        status.text.trim().length === 0
      ) {
        await database.updateNote({
          statusId,
          text: buildActivitySummary(activityData),
          summary: null
        })
      }

      await database.updateFitnessFileProcessingStatus(
        fitnessFileId,
        'completed'
      )

      if (publishSendNote) {
        await getQueue().publish({
          id: getHashFromString(`${statusId}:send-note`),
          name: SEND_NOTE_JOB_NAME,
          data: {
            actorId,
            statusId
          }
        })
      }
    } catch (error) {
      const nodeError = error as Error
      logger.error({
        message: 'Failed to process fitness file',
        actorId,
        statusId,
        fitnessFileId,
        error: nodeError.message
      })

      await database.updateFitnessFileProcessingStatus(fitnessFileId, 'failed')
    }
  }
)

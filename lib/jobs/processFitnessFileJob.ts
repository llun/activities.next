import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { buildActivityImportEmail } from '@/lib/services/email/templates/activityImport'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import { generateMapImage } from '@/lib/services/fitness-files/generateMapImage'
import { toImportErrorMessage } from '@/lib/services/fitness-files/importError'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import {
  getFitnessPrivacyLocations,
  getVisibleSegments
} from '@/lib/services/fitness-files/privacy'
import { saveMedia } from '@/lib/services/medias'
import { getActivityImportGroupKey } from '@/lib/services/notifications/activityImportGroupKey'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { PROCESS_FITNESS_FILE_JOB_NAME } from './names'

const JobData = z.object({
  actorId: z.string(),
  statusId: z.string(),
  fitnessFileId: z.string(),
  publishSendNote: z.boolean().optional().default(true),
  // Whether this run should tell the actor their activity arrived.
  //
  // Deliberately NOT derived from publishSendNote, which is false for the
  // Strava path, the user-triggered retry endpoint AND the scripts/fitness
  // backfills alike — reusing it would mass-mail on a backfill. Only a genuine
  // first import sets this, and only an unattended importer sets it at all: a
  // direct upload needs no email, because the user is watching the composer.
  notifyOnComplete: z.boolean().optional().default(false)
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

/**
 * Tell the actor their activity arrived, once the post is actually complete.
 *
 * Best-effort: a notification or delivery failure must not fail the import or
 * leave the file stuck in `processing`, so everything here is caught and
 * logged. Errors are reported rather than swallowed silently.
 */
const notifyActivityImported = async ({
  database,
  actorId,
  statusId,
  fitnessFileId,
  mapImageUrl
}: {
  database: Database
  actorId: string
  statusId: string
  fitnessFileId: string
  mapImageUrl?: string
}) => {
  try {
    const [actor, status, fitnessFile] = await Promise.all([
      database.getActorFromId({ id: actorId }),
      database.getStatus({ statusId, withReplies: false }),
      database.getFitnessFile({ id: fitnessFileId })
    ])
    if (!actor || !status) return

    const notification = await createNotificationWithPolicy(database, {
      actorId,
      type: 'activity_import',
      sourceActorId: actorId,
      statusId,
      groupKey: getActivityImportGroupKey(
        actorId,
        fitnessFile?.activityStartTime
      )
    })
    if (!notification || notification.filtered) return

    sendNotificationAlerts({
      database,
      actorId,
      sourceActorId: actorId,
      sourceActor: actor,
      statusId,
      events: [
        {
          type: 'activity_import',
          notificationId: notification.id,
          emailContent: actor.account
            ? {
                recipientEmail: actor.account.email,
                ...buildActivityImportEmail({
                  recipient: actor,
                  status: status as EditableStatus,
                  fitness: fitnessFile ?? undefined,
                  mapImageUrl
                })
              }
            : undefined
        }
      ]
    })
  } catch (error) {
    logger.error({
      message: 'Failed to notify actor of completed fitness import',
      actorId,
      statusId,
      fitnessFileId,
      err: error instanceof Error ? error : new Error(String(error))
    })
  }
}

export const processFitnessFileJob = createJobHandle(
  PROCESS_FITNESS_FILE_JOB_NAME,
  async (database, message) => {
    const {
      actorId,
      statusId,
      fitnessFileId,
      publishSendNote,
      notifyOnComplete
    } = JobData.parse(message.data)

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
      if (!isParseableFitnessFileType(fitnessFile.fileType)) {
        throw new Error(
          `Unsupported fitness file type for activity parsing: ${fitnessFile.fileType}`
        )
      }

      const activityData = await parseFitnessFile({
        fileType: fitnessFile.fileType,
        buffer: fitnessBuffer
      })

      await database.updateFitnessFileActivityData(fitnessFileId, {
        totalDistanceMeters: activityData.totalDistanceMeters,
        totalDurationSeconds: activityData.totalDurationSeconds,
        movingTimeSeconds: activityData.movingTimeSeconds ?? null,
        elevationGainMeters: activityData.elevationGainMeters,
        activityType: activityData.activityType,
        activityStartTime: activityData.startTime ?? null,
        hasMapData: false,
        mapImagePath: null,
        // Only overwrite each device field when parsing found a value for it.
        // Preserves device info already set from other sources (e.g. Strava import).
        // Each field is guarded independently so a file with manufacturer-but-no-product-name
        // does not erase a pre-existing deviceName.
        ...(activityData.deviceManufacturer !== undefined
          ? { deviceManufacturer: activityData.deviceManufacturer }
          : {}),
        ...(activityData.deviceName !== undefined
          ? { deviceName: activityData.deviceName }
          : {})
      })

      const privacySettings = await database.getFitnessSettings({
        actorId,
        serviceType: 'general'
      })
      const privacyLocation = getFitnessPrivacyLocations(privacySettings)
      const visibleSegments = getVisibleSegments(
        activityData.coordinates,
        privacyLocation
      )

      const filteredCoordinates = visibleSegments.flat()

      // Captured for the import email. Only set when a map was generated in
      // THIS run, which is exactly when the email is sent — a first import.
      let mapImageUrl: string | undefined

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

              mapImageUrl = storedMap.url
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

      // Notify only here, at the end of processing. Doing it where the import
      // is enqueued looks correct locally — NoQueue runs this job inline — but
      // under QStash the map and the parsed stats do not exist yet, so the
      // email would ship empty in production and full in dev.
      if (notifyOnComplete) {
        await notifyActivityImported({
          database,
          actorId,
          statusId,
          fitnessFileId,
          mapImageUrl
        })
      }

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

      // Route heatmaps are intentionally NOT regenerated here. Importing an
      // activity only creates its status and route map; the memory-heavy
      // per-actor heatmap aggregation runs solely on explicit request (the
      // fitness-route-heatmap route), so it can never pile onto the import /
      // Strava-webhook path and exhaust the worker's heap.
    } catch (error) {
      const errorMessage = toImportErrorMessage(
        error,
        'Unknown fitness processing error'
      )

      logger.error({
        message: 'Failed to process fitness file',
        actorId,
        statusId,
        fitnessFileId,
        error: errorMessage
      })

      await database.updateFitnessFileProcessingStatus(
        fitnessFileId,
        'failed',
        errorMessage
      )
    }
  }
)

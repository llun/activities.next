import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { buildActivityImportEmail } from '@/lib/services/email/templates/activityImport'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import { deleteEmailMapImage } from '@/lib/services/fitness-files/emailMapImage'
import { generateMapImage } from '@/lib/services/fitness-files/generateMapImage'
import {
  toImportErrorMessage,
  toLoggableError
} from '@/lib/services/fitness-files/importError'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import {
  getFitnessPrivacyLocations,
  getVisibleSegments
} from '@/lib/services/fitness-files/privacy'
import { saveMedia, saveMediaImageRendition } from '@/lib/services/medias'
import { getActivityImportGroupKey } from '@/lib/services/notifications/activityImportGroupKey'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { shouldSendEmailForNotification } from '@/lib/services/notifications/emailNotificationSettings'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
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
 * Whether this run will actually email the owner about the import.
 *
 * `notifyOnComplete` alone only says the run is an unattended first import; it
 * says nothing about whether an email can be delivered. Checked so a copy of the
 * map is not stored on instances that send no email at all, or for an owner who
 * turned activity-import emails off. The one case still not knowable here is the
 * notification policy filtering the event, which is decided after the map exists.
 */
const willSendImportEmail = async ({
  database,
  actor,
  notifyOnComplete
}: {
  database: Database
  actor: Actor
  notifyOnComplete: boolean
}) => {
  if (!notifyOnComplete) return false
  if (!getConfig().email) return false
  if (!actor.account) return false

  try {
    return await shouldSendEmailForNotification(
      database,
      actor.id,
      'activity_import'
    )
  } catch (error) {
    // Never let a settings read decide the fate of the map. This runs inside the
    // map-generation try/catch, so a throw here would be logged as a map failure
    // and would skip the assignment entirely — leaving the email with no image
    // at all, not even the WebP fallback. Fail towards having the copy: the cost
    // of a wrong guess is one small unused file, versus an Outlook recipient
    // losing their route.
    logger.warn({
      message:
        'Could not read email notification settings; storing the route map copy anyway',
      actorId: actor.id,
      error: toImportErrorMessage(error, 'Unknown settings read error')
    })
    return true
  }
}

/**
 * Store a JPEG copy of the route map, for the import email only.
 *
 * Every image the media storages write is WebP. Gmail, Apple Mail and new
 * Outlook decode it; Outlook desktop (which renders mail with the Word engine)
 * and Windows Mail do not, so those recipients got the `alt` text where their
 * route should have been. This copy is not attached to the status, never
 * federates, and is not what any web surface renders — it exists so the email
 * has an `<img src>` every mail client can display. Its path is recorded on the
 * fitness file so it stays tied to the map it was made from.
 *
 * Returns the URL to put in the email, or undefined when no copy could be
 * stored — the caller then falls back to the WebP, which is what every activity
 * imported before this column existed still uses.
 */
const storeEmailMapImage = async ({
  database,
  actor,
  statusId,
  fitnessFileId,
  mapImageFile
}: {
  database: Database
  actor: Actor
  statusId: string
  fitnessFileId: string
  mapImageFile: File
}): Promise<string | undefined> => {
  try {
    const rendition = await saveMediaImageRendition(
      database,
      actor,
      mapImageFile,
      'jpeg'
    )
    if (!rendition) {
      logger.warn({
        message: 'Failed to store the route map copy for email',
        actorId: actor.id,
        statusId,
        fitnessFileId
      })
      return undefined
    }

    await database.updateFitnessFileActivityData(fitnessFileId, {
      mapImageEmailPath: rendition.path
    })
    return rendition.url
  } catch (error) {
    // Best-effort: the map is already stored and attached by the time this
    // runs, so failing here costs Outlook recipients their image and nothing
    // else. It must never fail the import.
    logger.warn({
      message: 'Failed to store the route map copy for email',
      actorId: actor.id,
      statusId,
      fitnessFileId,
      error: toImportErrorMessage(error, 'Unknown route map copy error')
    })
    return undefined
  }
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

      // The reset below de-references any copy an earlier run stored, so delete
      // the file too. A retry or a recovery script leaves notifyOnComplete
      // false, so nothing would rewrite the column: without this the object is
      // orphaned, and worse, if the owner added a privacy location before
      // reprocessing, the old UNFILTERED route would stay fetchable at its
      // unchanged URL.
      await deleteEmailMapImage({
        database,
        fitnessFileId,
        mapImageEmailPath: fitnessFile.mapImageEmailPath
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
        mapImageEmailPath: null,
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

      // Set when the route map could not be produced or stored. The post is
      // worth keeping without its map, so this does not abort the import — but
      // it is recorded on the fitness file below instead of passing silently,
      // the same way regenerateFitnessMapsJob records its map failures. A
      // persistent map outage would otherwise produce map-less posts forever
      // with no signal to the owner or the operator.
      let mapErrorMessage: string | undefined

      if (filteredCoordinates.length >= 2) {
        try {
          const mapImageBuffer = await generateMapImage({
            coordinates: filteredCoordinates,
            routeSegments: visibleSegments
          })

          // The caller already established there is a route to draw, so an
          // empty buffer here means the renderer produced nothing — a failure,
          // not "this activity has no map". Treated as one in both jobs.
          if (!mapImageBuffer) {
            throw new Error('Generated map image buffer is empty')
          }

          const mapImageBytes = new Uint8Array(mapImageBuffer)
          const mapImageFile = new File(
            [mapImageBytes],
            `${fitnessFileId}-route-map.png`,
            {
              type: 'image/png'
            }
          )
          const storedMap = await saveMedia(database, actor, {
            file: mapImageFile,
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

          // The WebP is what the post and every web surface use; the email
          // prefers a JPEG copy, because Outlook desktop cannot decode WebP.
          // Only store one when an email is genuinely going out, otherwise it
          // is storage spent on an image nobody will ever fetch: a direct
          // upload notifies no one, an instance with no email configured sends
          // nothing, and the owner may have turned activity-import emails off.
          mapImageUrl = (await willSendImportEmail({
            database,
            actor,
            notifyOnComplete
          }))
            ? ((await storeEmailMapImage({
                database,
                actor,
                statusId,
                fitnessFileId,
                mapImageFile
              })) ?? storedMap.url)
            : storedMap.url
        } catch (error) {
          mapErrorMessage = toImportErrorMessage(
            error,
            'Unknown route map generation error'
          )
          logger.error({
            message: 'Failed to generate route map for fitness activity',
            actorId,
            statusId,
            fitnessFileId,
            error: mapErrorMessage,
            err: toLoggableError(error)
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

      // A map failure lands here rather than in the catch below: the activity
      // itself imported, so the post keeps its text, its stats and its
      // federation. Recording `failed` with the reason is what makes the
      // missing map visible — the post shows a retry affordance to its owner
      // and the file is picked up by the retry endpoints, exactly as a map
      // failure in regenerateFitnessMapsJob is. The cost is that a file in
      // `failed` is excluded from the fitness stats/heatmap rollups until a
      // retry succeeds, which is the same trade-off that job already makes.
      await database.updateFitnessFileProcessingStatus(
        fitnessFileId,
        mapErrorMessage ? 'failed' : 'completed',
        mapErrorMessage
      )

      // Notify only here, at the end of processing. Doing it where the import
      // is enqueued looks correct locally — NoQueue runs this job inline — but
      // under QStash the map and the parsed stats do not exist yet, so the
      // email would ship empty in production and full in dev.
      //
      // Behaviour change worth knowing: an import whose PROCESSING fails now
      // produces no activity_import notification at all, where the old
      // enqueue-time call produced one as soon as the status existed. That is
      // intended — "your activity arrived" should not fire for an activity that
      // did not finish arriving — and the failure is already surfaced in the
      // fitness UI with a retry affordance. A map-only failure is the one
      // exception: the activity DID arrive, so it still notifies, and the email
      // simply carries no map image (`mapImageUrl` stays undefined).
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
)

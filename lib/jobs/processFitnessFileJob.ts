import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { buildActivityImportEmail } from '@/lib/services/email/templates/activityImport'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import { deleteEmailMapImage } from '@/lib/services/fitness-files/emailMapImage'
import { generateMapImage } from '@/lib/services/fitness-files/generateMapImage'
import { toImportErrorMessage } from '@/lib/services/fitness-files/importError'
import {
  ROUTE_MAP_ATTACHMENT_NAME,
  findRouteMapAttachments,
  getAttachmentMediaIds,
  removeRouteMapAttachmentsAndMedia
} from '@/lib/services/fitness-files/mapAttachments'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import {
  getFitnessPrivacyLocations,
  getVisibleSegments
} from '@/lib/services/fitness-files/privacy'
import { normalizeActivityTypeToSportKey } from '@/lib/services/fitness-files/sportTypes'
import { evaluateGearServiceReminders } from '@/lib/services/fitness-gears/serviceReminders'
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
import { toLoggableError } from '@/lib/utils/toLoggableError'

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
  notifyOnComplete: z.boolean().optional().default(false),
  // Set only by the per-status retry endpoint, and only for a file whose
  // activity is fine and whose route map is not. It says: this run is a
  // reprocess of a LIVE activity, so a failure here must not demote it.
  //
  // Deliberately passed in rather than read from the row: every publisher
  // (including that endpoint) writes `pending`/`processing` before publishing,
  // so by the time this job reads the file its previous status is already gone.
  retryingMapFailure: z.boolean().optional().default(false)
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

  // `Object.hasOwn`, not a bare index: the table is an object literal, so it
  // inherits `Object.prototype`. `activityType` is free-form text out of the
  // uploaded file, and a `constructor` value would otherwise destructure the
  // `Object` constructor into `{label, emoji}` and write
  // "undefined undefined — 5.20 km" into the post body.
  if (Object.hasOwn(ACTIVITY_LABELS, normalized)) {
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
      error: toImportErrorMessage(error, 'Unknown settings read error'),
      err: toLoggableError(error)
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
      error: toImportErrorMessage(error, 'Unknown route map copy error'),
      err: toLoggableError(error)
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
      err: toLoggableError(error)
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
      notifyOnComplete,
      retryingMapFailure
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

      // The map this file already has on the status, matched by its own
      // recorded path so a merged same-ride post never loses the other file's.
      // Removed only once a replacement is safely stored — deleting up front
      // means a run that then fails to render leaves the activity with no map
      // at all, turning a failed reprocess into data loss. Same guard
      // regenerateFitnessMapsJob makes.
      const previousMapAttachments = await findRouteMapAttachments({
        database,
        statusId,
        mapImagePath: fitnessFile.mapImagePath
      })
      if (fitnessFile.mapImagePath && previousMapAttachments.length === 0) {
        // The file names a map that no attachment on the status matches — the
        // two went out of step somewhere. Not fatal (the run below attaches a
        // fresh map), but nothing will clean up whatever the pointer used to
        // refer to, so it is not a state either side should reach.
        logger.warn({
          message: 'Recorded route map has no matching attachment to replace',
          actorId,
          statusId,
          fitnessFileId,
          mapImagePath: fitnessFile.mapImagePath
        })
      }

      // Contained on purpose: by the time this runs the replacement is already
      // stored, so a failure here costs a leftover file and nothing else. Left
      // uncontained it would be recorded as a map-generation failure on a run
      // that produced a perfectly good map (or, in the no-route branch, fail
      // the whole activity) — the opposite of what the reason column is for.
      // Returns whether the previous map is really gone. The caller keeps the
      // file's pointer to it until then: the pointer is the only thing that can
      // identify the attachment on a later run, and dropping it while the
      // attachment survives leaves a route the owner asked to hide on a public
      // post with nothing able to find it again.
      const dropPreviousMap = async () => {
        try {
          await deleteEmailMapImage({
            database,
            fitnessFileId,
            mapImageEmailPath: fitnessFile.mapImageEmailPath
          })

          if (previousMapAttachments.length === 0) return true
          if (!actor.account) {
            // Nothing can resolve the media rows without an account, and
            // leaving the attachment in place shows the route twice.
            logger.warn({
              message:
                'Cannot remove the previous route map: actor has no account',
              actorId,
              statusId,
              fitnessFileId
            })
            return false
          }

          await removeRouteMapAttachmentsAndMedia({
            database,
            accountId: actor.account.id,
            statusId,
            attachmentIds: previousMapAttachments.map(
              (attachment) => attachment.id
            ),
            mediaIds: getAttachmentMediaIds(previousMapAttachments)
          })
          return true
        } catch (error) {
          // Logged, not recorded on the file. The replacement is already
          // stored and attached, so what a failure here leaves behind is a
          // stale attachment — visible, but nothing the owner can act on: a
          // retry would attach a third map, not remove the second. Recording it
          // as a map failure needs a repair key that survives every later run,
          // which a free-text column cannot be. `scripts/maintenance/
          // cleanupMediaStorage.ts` is what reclaims the bytes.
          logger.error({
            message: 'Failed to remove the previous route map',
            actorId,
            statusId,
            fitnessFileId,
            err: toLoggableError(error)
          })
          return false
        }
      }

      await database.updateFitnessFileActivityData(fitnessFileId, {
        totalDistanceMeters: activityData.totalDistanceMeters,
        totalDurationSeconds: activityData.totalDurationSeconds,
        movingTimeSeconds: activityData.movingTimeSeconds ?? null,
        elevationGainMeters: activityData.elevationGainMeters,
        activityType: activityData.activityType,
        activityStartTime: activityData.startTime ?? null,
        // Cleared up front so a re-run never shows the previous run's map
        // failure while it is busy producing a map. The map columns themselves
        // are NOT reset here: until a replacement exists, the map this file
        // already has is the best it has.
        mapError: null,
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

      // Auto-assign gear from the owner's default-sport mapping, now that the
      // parsed `activityType` is known. This is the ONLY automatic attribution
      // there is — imports deliberately read no gear from their source, so an
      // imported activity lands here exactly like an uploaded one (see
      // AGENTS.md → Fitness Gear). It still only ever fills a hole: a manual
      // assignment wins, which `assignFitnessFileGearIfUnset` enforces with its
      // guarded UPDATE, and these jobs re-run. Attribution is metadata — the
      // whole block is best-effort so it can never fail a file that parsed
      // fine.
      if (!fitnessFile.gearId) {
        try {
          const sportKey = normalizeActivityTypeToSportKey(
            activityData.activityType
          )
          if (sportKey) {
            const defaultGear = await database.findFitnessGearByDefaultSport({
              actorId,
              sportKey
            })
            if (defaultGear) {
              await database.assignFitnessFileGearIfUnset({
                fitnessFileId,
                actorId,
                gearId: defaultGear.id
              })
            }
          }
        } catch (error) {
          logger.warn({
            message: 'Failed to auto-assign gear for fitness file',
            actorId,
            statusId,
            fitnessFileId,
            err: toLoggableError(error)
          })
        }
      }

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

      // Set when the route map could not be produced or stored. Recorded on the
      // fitness file below rather than passing silently — a persistent map
      // outage would otherwise produce map-less posts forever with no signal to
      // the owner or the operator.
      //
      // It is deliberately NOT `processingStatus: 'failed'`: that flag means
      // "this activity is not usable" and gates the status detail dashboard,
      // the post's stat grid, the fitness overview, the profile's Fitness tab
      // and every stats/heatmap rollup. The activity here parsed fine and its
      // post federated — only the image is missing.
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
            name: ROUTE_MAP_ATTACHMENT_NAME,
            mediaId: storedMap.id
          })

          await database.updateFitnessFileActivityData(fitnessFileId, {
            hasMapData: true,
            mapImagePath: getAttachmentMediaPath(storedMap.url),
            mapImageEmailPath: null
          })

          // The replacement is stored and attached, so the previous map can go.
          // Doing it here rather than up front is what keeps a failed reprocess
          // from costing the activity the map it already had; doing it at all is
          // what stops the post rendering the same route twice, and what stops a
          // pre-privacy-filter image staying fetchable at its unchanged URL
          // after the owner added a privacy location.
          await dropPreviousMap()

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

          try {
            await database.updateFitnessFileActivityData(fitnessFileId, {
              mapError: mapErrorMessage
            })
          } catch (writeError) {
            // Recording the reason must never cost the import. Letting this
            // reach the outer catch would mark a parsed activity `failed`, skip
            // the summary backfill and skip the federation publish — the exact
            // outcome this whole change exists to prevent, over a DB blip.
            logger.error({
              message: 'Failed to record the route map failure reason',
              actorId,
              statusId,
              fitnessFileId,
              err: toLoggableError(writeError)
            })
          }
        }
      } else {
        // No route to draw (indoor activity, or a privacy zone that swallows
        // the whole route). Any map this file used to have is now wrong — and
        // in the privacy case it is the very route the owner just hid, so the
        // pointer to it is kept unless the removal actually succeeded.
        if (await dropPreviousMap()) {
          await database.updateFitnessFileActivityData(fitnessFileId, {
            hasMapData: false,
            mapImagePath: null,
            mapImageEmailPath: null
          })
        } else {
          // Recorded here, unlike on the replace path: no replacement was
          // attached, so a retry re-attempts exactly this removal instead of
          // adding a third map — and until it succeeds the post is publicly
          // showing the route the owner just hid. `hasMapData` is still true,
          // so the owner reads it as "could not be updated", which is what it
          // is.
          mapErrorMessage = 'Failed to remove the route map'
          await database
            .updateFitnessFileActivityData(fitnessFileId, {
              mapError: mapErrorMessage
            })
            .catch((writeError) => {
              logger.error({
                message: 'Failed to record the route map removal failure',
                actorId,
                statusId,
                fitnessFileId,
                err: toLoggableError(writeError)
              })
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

      // `completed` even when the map failed: the file parsed, the stats are
      // stored and the post is live, so every surface gated on `completed` —
      // the detail dashboard, the stat grid, the overview, the rollups — should
      // show it. The missing map travels separately in `mapError`, which the
      // post surfaces to its owner as a retry.
      await database.updateFitnessFileProcessingStatus(
        fitnessFileId,
        'completed'
      )

      // This activity's distance has just landed on whatever gear it belongs
      // to, so it may have pushed a pair of shoes or a component past its
      // service threshold.
      //
      // Deliberately AFTER the `completed` write, not next to the gear
      // assignment above: the rollups only count completed activities, so
      // evaluating any earlier reads the total from BEFORE this ride and the
      // reminder is systematically one activity late — never firing at all if
      // this was the last ride on that gear.
      //
      // Re-read the row rather than reusing the pre-update copy: the gear may
      // have been attributed a moment ago, by the auto-assign above or by the
      // import that created the file. Evaluated here because there is no
      // scheduler to evaluate it on — the queue can delay a message but not
      // repeat one.
      //
      // Contained, and it has to be: everything above has already been written
      // and the activity is `completed`, but this block still sits inside the
      // outer try — so an uncaught blip on this read would fall through to the
      // failure handler and mark a finished activity `failed`, hiding it from
      // the dashboard, the overview, every rollup and federation, over a read
      // that only decides whether to send a courtesy email.
      // `evaluateGearServiceReminders` contains its own failures; this catch is
      // for the read in front of it.
      try {
        const attributedFile = await database.getFitnessFile({
          id: fitnessFileId
        })
        if (attributedFile?.gearId) {
          await evaluateGearServiceReminders({
            database,
            actorId,
            gearIds: [attributedFile.gearId]
          })
        }
      } catch (error) {
        logger.error({
          message: 'Failed to evaluate gear service reminders after processing',
          actorId,
          statusId,
          fitnessFileId,
          err: toLoggableError(error)
        })
      }

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
      // fitness UI with a retry affordance. A map-only failure is not such a
      // case: the activity arrived, so it notifies as usual, and the email
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

      // A replaced map is deliberately NOT federated from here. Whether the
      // status was ever federated is not knowable in this job — the file
      // importer creates local-only statuses, and a first import that failed
      // never published its Create — so an Update from here would describe an
      // object half the receivers have never seen. The user-facing path for
      // re-federating a changed map is Regenerate maps, which knows the status
      // is live because it only ever runs over existing ones.

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

      // A map retry runs against an activity that parsed, posted and federated
      // already. Demoting it to `failed` because this run hit a storage timeout
      // would hide a perfectly good activity from the detail dashboard, the
      // stat grid, the overview, the profile's Fitness tab and every rollup —
      // the exact harm this change exists to prevent. Record the reason as what
      // it is, a map that is still missing, and leave the activity alone.
      if (retryingMapFailure) {
        try {
          await database.updateFitnessFileActivityData(fitnessFileId, {
            mapError: errorMessage
          })
          await database.updateFitnessFileProcessingStatus(
            fitnessFileId,
            'completed'
          )
          return
        } catch (writeError) {
          // Contained like every other reason-write here: rethrowing would
          // leave the file in `processing` until the staleness window, which is
          // the state this branch exists to avoid.
          logger.error({
            message: 'Failed to restore a retried activity after a failure',
            actorId,
            statusId,
            fitnessFileId,
            err: toLoggableError(writeError)
          })
          return
        }
      }

      await database.updateFitnessFileProcessingStatus(
        fitnessFileId,
        'failed',
        errorMessage
      )

      // A whole-activity failure supersedes any map reason: the file's own
      // status now carries the diagnostic, and leaving both set makes the
      // fitness files page report a missing map instead of a failed import.
      try {
        await database.updateFitnessFileActivityData(fitnessFileId, {
          mapError: null
        })
      } catch (writeError) {
        logger.error({
          message: 'Failed to clear the route map reason on a failed file',
          actorId,
          statusId,
          fitnessFileId,
          err: toLoggableError(writeError)
        })
      }
    }
  }
)

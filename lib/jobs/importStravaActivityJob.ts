import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { z } from 'zod'

import {
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { UpdateFitnessFileActivityData } from '@/lib/database/sql/fitnessFile'
import { Database } from '@/lib/database/types'
import {
  OVERLAP_CONTEXT_SCAN_LIMIT,
  getOverlapContextFitnessFileIds
} from '@/lib/jobs/fitnessImportOverlap'
import { importFitnessFiles } from '@/lib/jobs/importFitnessFilesJob'
import {
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  REGENERATE_FITNESS_MAPS_JOB_NAME,
  SEND_NOTE_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { buildActivityImportEmail } from '@/lib/services/email/templates/activityImport'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { toImportErrorMessage } from '@/lib/services/fitness-files/importError'
import { withImportLock } from '@/lib/services/fitness-files/importLock'
import { linkFitnessFileDeviceGear } from '@/lib/services/fitness-gears/resolveDeviceGear'
import { MAX_ATTACHMENTS } from '@/lib/services/medias/constants'
import { saveMedia } from '@/lib/services/medias/index'
import { getActivityImportGroupKey } from '@/lib/services/notifications/activityImportGroupKey'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import { JobMessage } from '@/lib/services/queue/type'
import {
  StravaActivity,
  buildGpxFromStravaStreams,
  buildStravaActivitySummary,
  buildTcxFromStravaStreams,
  getStravaActivity,
  getStravaActivityDurationSeconds,
  getStravaActivityPhotos,
  getStravaActivityStartTimeMs,
  getStravaActivityStreams,
  getStravaActivityUrl,
  getValidStravaAccessToken,
  isSupportedStravaPhotoMimeType,
  mapStravaVisibilityToMastodon
} from '@/lib/services/strava/activity'
import { getStravaActivityBatchId } from '@/lib/services/strava/activityBatch'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Actor, getMention } from '@/lib/types/domain/actor'
import { EditableStatus, Status, StatusType } from '@/lib/types/domain/status'
import { Visibility } from '@/lib/types/mastodon/visibility'
import { getManufacturerKeyFromDeviceName } from '@/lib/utils/fitnessDeviceBrands'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import {
  SAFE_DOWNLOAD_MAX_BYTES,
  readResponseArrayBufferWithLimit
} from '@/lib/utils/streamLimit'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { createJobHandle } from './createJobHandle'

const JobData = z.object({
  actorId: z.string(),
  stravaActivityId: z
    .union([z.string(), z.number()])
    .transform((value) => String(value)),
  stravaAuth: z
    .object({
      appId: z.string(),
      appSecret: z.string(),
      accessToken: z.string()
    })
    .optional(),
  visibility: Visibility.optional(),
  // Whether a completed import should email the actor.
  //
  // Set by the caller, never hardcoded here. The webhook is only one of this
  // job's five entry points: retry-all (POST /api/v1/fitness/retry-failed) and
  // three scripts/fitness recovery tools also drive it, and each of those is a
  // bulk operation over every failed batch for an actor — exactly the case
  // where a re-import DOES create a brand-new status. Hardcoding true here
  // would mail once per recovered activity.
  //
  // Defaults to false so a caller is silent until it opts in.
  notifyOnComplete: z.boolean().optional().default(false),
  // Whether a status newly created by this import should federate its Create.
  //
  // Set by the same single caller as notifyOnComplete and for the same reason:
  // the webhook carries one freshly recorded activity the user expects their
  // followers to see, while retry-all and the recovery scripts sweep every
  // failed batch for an actor — opting those in would deliver a Create per
  // recovered activity.
  //
  // Defaults to false so a caller is silent until it opts in.
  publishSendNote: z.boolean().optional().default(false)
})

const MAX_STRAVA_PHOTOS_TO_ATTACH = 4
const STRAVA_PHOTO_ADDRESS_BLOCK_LIST = new BlockList()

STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('0.0.0.0', 8)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('10.0.0.0', 8)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('100.64.0.0', 10)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('127.0.0.0', 8)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('169.254.0.0', 16)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('172.16.0.0', 12)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('192.0.0.0', 24)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('192.0.2.0', 24)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('192.168.0.0', 16)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('198.18.0.0', 15)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('198.51.100.0', 24)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('203.0.113.0', 24)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('224.0.0.0', 4)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('240.0.0.0', 4)
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('::', 128, 'ipv6')
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('::1', 128, 'ipv6')
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('fc00::', 7, 'ipv6')
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('fe80::', 10, 'ipv6')
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('ff00::', 8, 'ipv6')
STRAVA_PHOTO_ADDRESS_BLOCK_LIST.addSubnet('2001:db8::', 32, 'ipv6')

const getStravaFallbackPostId = ({
  actorId,
  stravaActivityId
}: {
  actorId: string
  stravaActivityId: string
}) => {
  return getHashFromString(`${actorId}:strava-note:${stravaActivityId}`)
}

const getAttachmentName = (photoId: string | undefined, index: number) => {
  return photoId ? `Strava photo ${photoId}` : `Strava photo ${index + 1}`
}

const getPhotoFileExtension = (mimeType: string) => {
  return mimeType === 'image/png' ? 'png' : 'jpg'
}

const isRestrictedStravaPhotoHostname = (hostname: string) => {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  )
}

const isRestrictedStravaPhotoAddress = (address: string) => {
  const family = isIP(address)
  if (family === 0) {
    return true
  }

  return STRAVA_PHOTO_ADDRESS_BLOCK_LIST.check(
    address,
    family === 6 ? 'ipv6' : 'ipv4'
  )
}

const getSafeStravaPhotoUrl = async (photoUrl: string) => {
  let url: URL
  try {
    url = new URL(photoUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    return null
  }

  const hostname = url.hostname.trim().toLowerCase()
  if (!hostname || isRestrictedStravaPhotoHostname(hostname)) {
    return null
  }

  if (isIP(hostname)) {
    return isRestrictedStravaPhotoAddress(hostname) ? null : url
  }

  const resolvedAddresses = await lookup(hostname, {
    all: true,
    verbatim: true
  }).catch(() => [])

  if (
    resolvedAddresses.length === 0 ||
    resolvedAddresses.some(({ address }) =>
      isRestrictedStravaPhotoAddress(address)
    )
  ) {
    return null
  }

  return url
}

const attachStravaPhotosToStatus = async ({
  database,
  actor,
  actorId,
  statusId,
  stravaActivityId,
  accessToken,
  activity
}: {
  database: Database
  actor: Actor
  actorId: string
  statusId: string
  stravaActivityId: string
  accessToken: string
  activity: StravaActivity
}): Promise<number> => {
  let attachedCount = 0
  const existingAttachments = await database.getAttachments({ statusId })
  const attachmentNames = new Set(
    existingAttachments
      .map((attachment) => attachment.name ?? '')
      .filter((name) => name.length > 0)
  )
  const remainingAttachmentSlots = Math.max(
    0,
    MAX_ATTACHMENTS - existingAttachments.length
  )

  if (remainingAttachmentSlots <= 0) {
    return attachedCount
  }

  const photos = await getStravaActivityPhotos({
    activityId: stravaActivityId,
    accessToken,
    activity,
    limit: MAX_STRAVA_PHOTOS_TO_ATTACH
  })

  for (const [index, photo] of photos
    .slice(0, remainingAttachmentSlots)
    .entries()) {
    const attachmentName = getAttachmentName(photo.id, index)
    if (attachmentNames.has(attachmentName)) {
      continue
    }

    try {
      const photoUrl = await getSafeStravaPhotoUrl(photo.url)
      if (!photoUrl) {
        logger.warn({
          message: 'Skipping Strava photo with unsafe URL',
          actorId,
          stravaActivityId,
          photoUrl: photo.url
        })
        continue
      }

      const photoResponse = await fetch(photoUrl)
      if (!photoResponse.ok) {
        logger.warn({
          message: 'Failed to download Strava photo',
          actorId,
          stravaActivityId,
          status: photoResponse.status
        })
        continue
      }

      const contentType =
        photoResponse.headers
          .get('content-type')
          ?.split(';')[0]
          ?.trim()
          ?.toLowerCase() ?? ''
      if (!isSupportedStravaPhotoMimeType(contentType)) {
        logger.warn({
          message: 'Skipping Strava photo with unsupported content type',
          actorId,
          stravaActivityId,
          contentType
        })
        continue
      }

      const buffer = await readResponseArrayBufferWithLimit(
        photoResponse,
        SAFE_DOWNLOAD_MAX_BYTES,
        'Strava photo'
      )
      if (buffer.byteLength <= 0) {
        continue
      }

      const photoFile = new File(
        [new Uint8Array(buffer)],
        `strava-${stravaActivityId}-${photo.id ?? index + 1}.${getPhotoFileExtension(contentType)}`,
        { type: contentType }
      )

      const storedMedia = await saveMedia(database, actor, {
        file: photoFile,
        description: activity.name?.trim() || 'Strava activity photo'
      })
      if (!storedMedia) {
        continue
      }

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
      attachmentNames.add(attachmentName)
      attachedCount += 1
    } catch (error) {
      logger.warn({
        message: 'Failed to store Strava photo as attachment',
        actorId,
        stravaActivityId,
        err: toLoggableError(error)
      })
    }
  }

  return attachedCount
}

const getOrCreateStravaFallbackNote = async ({
  database,
  actor,
  activity,
  stravaActivityId,
  visibility
}: {
  database: Database
  actor: Actor
  activity: StravaActivity
  stravaActivityId: string
  visibility: z.infer<typeof Visibility>
}): Promise<{ status: Status; created: boolean }> => {
  // Deliberate exception to the publicId-tail convention (see Task 1.5 of the
  // UUIDv7 publicId plan): this id must stay a DETERMINISTIC sha256 of the
  // Strava activity so re-running the import finds the same status
  // (get-or-create idempotency) instead of minting a duplicate fallback note.
  // The row still gets a random v7 publicId from database.createNote below —
  // it just never equals this URI's tail, same as any remote status.
  const postId = getStravaFallbackPostId({
    actorId: actor.id,
    stravaActivityId
  })
  const statusId = `${actor.id}/statuses/${postId}`
  const existingStatus = await database.getStatus({
    statusId,
    withReplies: false
  })
  if (existingStatus) {
    return { status: existingStatus, created: false }
  }

  const text = buildStravaActivitySummary(activity)
  const to = statusRecipientsTo(actor, [], null, visibility)
  const cc = statusRecipientsCC(actor, [], null, visibility)

  try {
    const status = await database.createNote({
      id: statusId,
      url: `https://${actor.domain}/${getMention(actor)}/${postId}`,
      actorId: actor.id,
      text,
      summary: null,
      to,
      cc,
      reply: ''
    })
    return { status, created: true }
  } catch (error) {
    const duplicateStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    if (duplicateStatus) {
      return { status: duplicateStatus, created: false }
    }

    throw error
  }
}

export const importStravaActivityJob = createJobHandle(
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  async (database, message) => {
    const {
      actorId,
      stravaActivityId,
      stravaAuth,
      visibility,
      notifyOnComplete,
      publishSendNote
    } = JobData.parse(message.data)

    const actor = await database.getActorFromId({ id: actorId })
    const fitnessSettings =
      stravaAuth !== undefined
        ? {
            id: `cli-strava-auth:${actorId}`,
            actorId,
            serviceType: 'strava',
            clientId: stravaAuth.appId,
            clientSecret: stravaAuth.appSecret,
            accessToken: stravaAuth.accessToken,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        : await database.getFitnessSettings({
            actorId,
            serviceType: 'strava'
          })

    if (!actor || !fitnessSettings) {
      logger.warn({
        message: 'Skipping Strava import because actor or settings are missing',
        actorId,
        stravaActivityId
      })
      return
    }

    const accessToken = await getValidStravaAccessToken({
      database,
      fitnessSettings
    })
    if (!accessToken) {
      logger.warn({
        message: 'Skipping Strava import because access token is missing',
        actorId,
        stravaActivityId
      })
      return
    }

    const activity = await getStravaActivity({
      activityId: stravaActivityId,
      accessToken
    })
    const resolvedVisibility =
      visibility ?? mapStravaVisibilityToMastodon(activity.visibility)
    const batchId = getStravaActivityBatchId(stravaActivityId)

    // Only an activity Strava says is shared gets pushed anywhere, whatever the
    // account default says.
    //
    // The webhook always sends an explicit `visibility` (the actor's Strava
    // default), so the `only_me` -> `direct` arm of mapStravaVisibilityToMastodon
    // never gets a chance to apply on that path. That was harmless while every
    // import was local-only — the post existed at the account default and went
    // nowhere. Now that imports federate it would be a leak, and the account
    // default is the one setting a user would never think to check for it.
    //
    // An allowlist rather than `!== 'only_me'` because the field is optional:
    // absent, a denylist federates at the account default, which can be public.
    // mapStravaVisibilityToMastodon resolves the same unknown to `private`, so
    // failing closed here is the answer this codebase already gives.
    const isStravaSharedActivity =
      activity.visibility === 'everyone' ||
      activity.visibility === 'followers_only'
    const shouldFederateImport = publishSendNote && isStravaSharedActivity

    // Logged rather than left silent: the visibility type is open-ended, so a
    // value Strava adds later — or stops sending — would suppress federation
    // for every import, and the symptom ("my rides stopped appearing on other
    // servers") looks identical to the bug this opt-in exists to fix. Only for
    // a caller that asked to federate, and never for only_me, which is a
    // decision rather than a surprise.
    if (
      publishSendNote &&
      !isStravaSharedActivity &&
      activity.visibility !== 'only_me'
    ) {
      logger.warn({
        message: 'Not federating an import with an unrecognised visibility',
        actorId,
        stravaActivityId,
        stravaVisibility: activity.visibility ?? null
      })
    }

    // Nothing here reads `activity.gear_id`, and that is deliberate: gear is
    // attributed downstream by `processFitnessFileJob`, from the gear whose
    // `defaultSports` claims the parsed sport — the athlete's own shed, which
    // the Strava settings page edits. Importing Strava's value instead created
    // a local gear per Strava id, with a `kind` guessed from an undocumented id
    // prefix and immutable once wrong. Do not add an attribution step to this
    // job; there is no gear decision to make in it.
    const batchFiles = await database.getFitnessFilesByBatchId({ batchId })
    let targetFitnessFile =
      batchFiles.find((file) => file.actorId === actorId) ?? null

    if (!targetFitnessFile) {
      const streams = await getStravaActivityStreams({
        activityId: stravaActivityId,
        accessToken
      })
      const tcxContent = buildTcxFromStravaStreams(activity, streams)
      let exportFile: File | null = tcxContent
        ? new File([tcxContent], `strava-${stravaActivityId}.tcx`, {
            type: 'application/vnd.garmin.tcx+xml'
          })
        : null

      if (!exportFile) {
        const gpxContent = streams
          ? buildGpxFromStravaStreams(activity, streams)
          : null
        if (gpxContent) {
          exportFile = new File(
            [gpxContent],
            `strava-${stravaActivityId}.gpx`,
            { type: 'application/gpx+xml' }
          )
        }
      }

      if (!exportFile) {
        // This branch only runs for a degenerate activity with no positive
        // duration and no streams (buildTcxFromStravaStreams otherwise falls
        // back to the activity's elapsed/moving time). Such a status gets no
        // fitness_files row, so there is no place to store the source link and
        // the activity link is intentionally not embedded in the note text.
        // Log it so the omission is observable rather than silent.
        logger.info({
          message:
            'No exportable file for Strava activity, creating note from activity data without source link',
          actorId,
          stravaActivityId,
          sourceUrl: getStravaActivityUrl(stravaActivityId)
        })

        const { status: createdNote, created: isNewFallback } =
          await getOrCreateStravaFallbackNote({
            database,
            actor,
            activity,
            stravaActivityId,
            visibility: resolvedVisibility
          })

        await addStatusToTimelines(database, createdNote)
        await attachStravaPhotosToStatus({
          database,
          actor,
          actorId,
          statusId: createdNote.id,
          stravaActivityId,
          accessToken,
          activity
        })

        // Gated like the file-backed path above. This branch used to federate
        // unconditionally, which is the asymmetry that hid the missing Create
        // on the main path: a degenerate, streamless activity was the only
        // Strava import that ever reached a follower. Ungated it also means a
        // retry-all sweep or a scripts/fitness recovery run still delivers one
        // Create per streamless activity — exactly what the flag exists to
        // prevent — so it answers to the same opt-in.
        if (shouldFederateImport) {
          await getQueue().publish({
            id: getHashFromString(`${actorId}:strava-note:${stravaActivityId}`),
            name: SEND_NOTE_JOB_NAME,
            data: { actorId, statusId: createdNote.id }
          })
        }

        // Gated on notifyOnComplete as a whole, not just on the email. This
        // path never creates a fitness file — the activity had no exportable
        // streams — so it never reaches processFitnessFileJob and has to
        // notify for itself, and every channel has to be gated together.
        //
        // Gating only emailContent would leave push firing on every bulk
        // recovery run: `main` produced no push here at all (the branch created
        // the notification row and stopped), so an ungated fan-out would be a
        // new one-per-activity regression on the adjacent channel.
        //
        // It also keeps this path consistent with the main one, where the whole
        // notify step sits inside the same check: a retry or a repair script
        // creates the post silently, with no bell entry either.
        //
        // The email degrades to headline, lead and button: no route map, no
        // stats, because there are none.
        if (isNewFallback && notifyOnComplete) {
          const notification = await createNotificationWithPolicy(database, {
            actorId,
            type: 'activity_import',
            sourceActorId: actorId,
            statusId: createdNote.id,
            groupKey: getActivityImportGroupKey(
              actorId,
              activity.start_date ? Date.parse(activity.start_date) : undefined
            )
          })

          if (notification && !notification.filtered) {
            const status = await database.getStatus({
              statusId: createdNote.id,
              withReplies: false
            })
            if (status) {
              sendNotificationAlerts({
                database,
                actorId,
                sourceActorId: actorId,
                sourceActor: actor,
                statusId: createdNote.id,
                events: [
                  {
                    type: 'activity_import',
                    notificationId: notification.id,
                    emailContent: actor.account
                      ? {
                          recipientEmail: actor.account.email,
                          ...buildActivityImportEmail({
                            recipient: actor,
                            status: status as EditableStatus
                          })
                        }
                      : undefined
                  }
                ]
              })
            }
          }
        }

        return
      }

      const storedFitnessFile = await saveFitnessFile(database, actor, {
        file: exportFile,
        description: activity.description?.trim() || undefined,
        importBatchId: batchId,
        sourceUrl: getStravaActivityUrl(stravaActivityId) ?? undefined
      })

      if (!storedFitnessFile) {
        throw new Error(
          'Failed to store Strava activity export as a fitness file'
        )
      }

      // Seed the activity's start time and duration straight from the Strava
      // metadata, before async processing parses the file. The same-ride
      // overlap merge matches candidates on activityStartTime + duration, so
      // without this seed a second device's upload of the same ride can't find
      // its sibling until that sibling finishes processing — which fails
      // exactly when both imports arrive together (and worse when processing
      // stalls), leaving duplicate posts. Processing later overwrites these
      // with the parsed values.
      const importActivityData: UpdateFitnessFileActivityData = {}
      const activityStartMs = getStravaActivityStartTimeMs(activity)
      if (activityStartMs !== undefined) {
        importActivityData.activityStartTime = new Date(activityStartMs)
      }
      const activityDurationSeconds = getStravaActivityDurationSeconds(activity)
      if (activityDurationSeconds > 0) {
        importActivityData.totalDurationSeconds = activityDurationSeconds
      }
      if (activity.device_name) {
        const manufacturerKey = getManufacturerKeyFromDeviceName(
          activity.device_name
        )
        importActivityData.deviceName = activity.device_name
        if (manufacturerKey !== undefined) {
          importActivityData.deviceManufacturer = manufacturerKey
        }
      }
      if (Object.keys(importActivityData).length > 0) {
        await database.updateFitnessFileActivityData(
          storedFitnessFile.id,
          importActivityData
        )
      }

      await linkFitnessFileDeviceGear({
        database,
        actorId,
        fitnessFileId: storedFitnessFile.id,
        deviceName: importActivityData.deviceName,
        deviceManufacturer: importActivityData.deviceManufacturer
      })

      targetFitnessFile = await database.getFitnessFile({
        id: storedFitnessFile.id
      })
      if (!targetFitnessFile) {
        throw new Error('Stored Strava fitness file was not found in database')
      }
    } else {
      // Re-import: file already existed before this run. Backfill any source
      // metadata that was not stored on the earlier import.
      const backfillData: UpdateFitnessFileActivityData = {}

      if (
        activity.device_name &&
        (!targetFitnessFile.deviceName || !targetFitnessFile.deviceManufacturer)
      ) {
        const manufacturerKey = getManufacturerKeyFromDeviceName(
          activity.device_name
        )
        backfillData.deviceName = activity.device_name
        if (manufacturerKey !== undefined) {
          backfillData.deviceManufacturer = manufacturerKey
        }
      }

      if (!targetFitnessFile.sourceUrl) {
        const sourceUrl = getStravaActivityUrl(stravaActivityId)
        if (sourceUrl) {
          backfillData.sourceUrl = sourceUrl
        }
      }

      if (Object.keys(backfillData).length > 0) {
        await database.updateFitnessFileActivityData(
          targetFitnessFile.id,
          backfillData
        )
        // Merge the backfilled fields locally instead of re-reading the row, so
        // the existing statusId (and other state used below) is preserved.
        targetFitnessFile = {
          ...targetFitnessFile,
          ...(backfillData.deviceName
            ? { deviceName: backfillData.deviceName }
            : {}),
          ...(backfillData.deviceManufacturer
            ? { deviceManufacturer: backfillData.deviceManufacturer }
            : {}),
          ...(backfillData.sourceUrl
            ? { sourceUrl: backfillData.sourceUrl }
            : {})
        }
      }

      // Read off the merged row rather than `backfillData`, which is empty on
      // a re-import that had nothing left to backfill — the device fields were
      // already stored, and the link still has to be established for a file
      // imported before devices had rows of their own.
      await linkFitnessFileDeviceGear({
        database,
        actorId,
        fitnessFileId: targetFitnessFile.id,
        deviceName: targetFitnessFile.deviceName,
        deviceManufacturer: targetFitnessFile.deviceManufacturer
      })
    }

    const isNewImport = !targetFitnessFile.statusId
    let deferredProcessJobs: JobMessage[] = []
    if (isNewImport) {
      // Serialize the post-creation critical section per actor. Strava delivers
      // one webhook per activity, so a single ride recorded on two devices
      // arrives as two activities at nearly the same moment and their imports
      // would otherwise run concurrently — each scanning for a sibling before
      // either has assigned a status, so each creates its own post (duplicate
      // same-ride posts). Holding the lock means the sibling's import has
      // already assigned its status by the time this one scans, so the overlap
      // merge in importFitnessFiles finds it and collapses both files into a
      // single post.
      const importedGroups = await withImportLock(
        database,
        `strava-import:${actorId}`,
        async () => {
          const actorFitnessFiles = await database.getFitnessFilesByActor({
            actorId,
            limit: OVERLAP_CONTEXT_SCAN_LIMIT
          })
          const overlapFitnessFileIds = getOverlapContextFitnessFileIds({
            actorId,
            fitnessFileId: targetFitnessFile.id,
            activityStartTime: getStravaActivityStartTimeMs(activity),
            activityDurationSeconds: getStravaActivityDurationSeconds(activity),
            files: actorFitnessFiles
          })

          return importFitnessFiles(
            database,
            {
              actorId,
              batchId,
              fitnessFileIds: [targetFitnessFile.id],
              overlapFitnessFileIds,
              visibility: resolvedVisibility,
              // Forwarded from this job's own caller, so only the webhook — one
              // activity, arriving while the user is elsewhere — emails.
              notifyOnComplete,
              // Same: only the webhook federates. A merged sibling reuses the
              // existing status, so importFitnessFiles resolves this to false
              // for it and the ride's Create still goes out exactly once.
              publishSendNote: shouldFederateImport
            },
            // The process job is the pipeline's federation trigger, and under
            // NoQueue publishing it runs it inline — before the Strava caption
            // and photos below exist. Publishing after those writes keeps the
            // Create describing the finished post in both queue modes.
            { deferProcessJobPublishes: true }
          )
        }
      )

      deferredProcessJobs = importedGroups
        .map((group) => group.processJob)
        .filter((processJob): processJob is JobMessage => processJob !== null)
    }

    const importedFitnessFile = await database.getFitnessFile({
      id: targetFitnessFile.id
    })
    if (!importedFitnessFile?.statusId) {
      logger.warn({
        message: 'Strava import finished without assigning a status',
        actorId,
        stravaActivityId,
        fitnessFileId: targetFitnessFile.id
      })
      return
    }

    const status = await database.getStatus({
      statusId: importedFitnessFile.statusId,
      withReplies: false
    })

    // Best effort, and deliberately not fatal: the process job below is what
    // finishes the import, so letting a caption write take the whole job down
    // would strand the file mid-pipeline with no map at all. Degrading here is
    // benign — processFitnessFileJob backfills the generated activity summary
    // whenever the text is still empty.
    try {
      if (
        status?.type === StatusType.enum.Note &&
        status.text.trim().length === 0
      ) {
        await database.updateNote({
          statusId: status.id,
          text: buildStravaActivitySummary(activity),
          summary: null
        })
      }
    } catch (error) {
      logger.warn({
        message: 'Failed to write the Strava caption to the imported status',
        actorId,
        stravaActivityId,
        statusId: importedFitnessFile.statusId,
        err: toLoggableError(error)
      })
    }

    // Published here, between the caption and the photos, because the two
    // hazards pull in opposite directions.
    //
    // Publishing it inside importFitnessFiles (where the non-deferred callers
    // still do) is too early: under NoQueue `publish` runs the job inline, so
    // it would federate the note before the caption above exists — an empty
    // note that nothing ever re-sends.
    //
    // Publishing it after the photos is too late: by now
    // assignFitnessFilesToImportedStatus has already set the primary file to
    // importStatus 'completed' / processingStatus 'pending', which NO retry
    // predicate matches (isFitnessProcessingStuck wants 'processing',
    // isFitnessImportStuck wants an import-'pending' file with no status). A
    // worker killed during the photo downloads — four HTTP fetches plus
    // transcodes, against QStash's 30s cap and zero retries — would leave the
    // ride permanently unprocessed and unreachable by every retry path.
    //
    // The cost is that a photo attached after this point may miss the Create.
    // Under QStash it almost never does: the process job still has to generate
    // the route map before it queues SEND_NOTE, and sendNoteJob re-reads the
    // status at delivery. Under NoQueue the whole chain runs inline right here,
    // so a dev-mode Create carries the caption and map but not the photos.
    let processJobPublishFailed = false
    for (const processJob of deferredProcessJobs) {
      try {
        await getQueue().publish(processJob)
      } catch (error) {
        processJobPublishFailed = true

        // Only the PROCESSING column, unlike the non-deferred path's
        // markImportFileFailed. The import itself succeeded — the status is
        // written, timelined and carries the caption — and what failed is the
        // work after it, so deleting the status would destroy real content and
        // failing the import would strand the file: retryFitnessImportBatch
        // resets a failed import to `pending`, but re-running this job then
        // short-circuits past the importer because a statusId already exists,
        // and nothing else ever writes importStatus back to `completed`. Its
        // own docstring calls that out. Leaving it `completed` keeps the file
        // retriable through the processing predicate, and
        // buildProcessingStatusUpdate still persists the reason.
        const errorMessage = toImportErrorMessage(error)

        logger.error({
          message: 'Failed to publish fitness processing job after import',
          actorId,
          stravaActivityId,
          statusId: importedFitnessFile.statusId,
          fitnessFileId: targetFitnessFile.id,
          err: toLoggableError(error)
        })

        await database.updateFitnessFileProcessingStatus(
          targetFitnessFile.id,
          'failed',
          errorMessage
        )
      }
    }

    // Separately contained from the caption: a photo failure must not skip the
    // caption, and neither may take down the import now that the file is past
    // the point where a retry could find it.
    let attachedPhotoCount = 0
    try {
      attachedPhotoCount = await attachStravaPhotosToStatus({
        database,
        actor,
        actorId,
        statusId: importedFitnessFile.statusId,
        stravaActivityId,
        accessToken,
        activity
      })
    } catch (error) {
      logger.warn({
        message: 'Failed to attach Strava photos to imported status',
        actorId,
        stravaActivityId,
        statusId: importedFitnessFile.statusId,
        err: toLoggableError(error)
      })
    }

    // A photo attached after the Create needs an Update or the remote copy
    // keeps the version without it, forever. Two cases land here: the process
    // job published above already federated (always under NoQueue, a race under
    // QStash), and a merged sibling, which brings its OWN Strava photos to a
    // post whose Create went out with the primary's.
    //
    // Gated on the same opt-in as the Create, and that gate is load-bearing
    // rather than tidiness: sendUpdateNoteJob consults no opt-in of its own —
    // it delivers to every follower inbox, plus every accepted relay for a
    // public audience — and an Update embeds the whole note, so the content
    // leaves the instance whatever the receiver decides to do with it. Some
    // implementations additionally treat an Update for an object they have
    // never seen as a Create. Ungated, a recovery sweep — or an only_me
    // activity, which reaches here having deliberately skipped its Create —
    // would ship a status precisely because it had a photo. For the same reason
    // gated on the process job having been queued: that job is what sends the
    // Create, so after it failed to publish an Update is the only thing that
    // would reach the network, federating a ride we just marked failed and
    // whose retry (through retryImports, which does not opt in) never sends a
    // Create of its own.
    //
    // The id carries the Strava activity so a merged sibling's photos get their
    // own Update rather than being deduplicated against the primary's, while a
    // redelivery of the same webhook still collapses.
    //
    // Kept out of the photo try/catch above so a failure here is not reported
    // as a photo failure — the photos are on the status either way, and what
    // was lost is the Update.
    if (
      shouldFederateImport &&
      attachedPhotoCount > 0 &&
      !processJobPublishFailed
    ) {
      try {
        await getQueue().publish({
          id: getHashFromString(
            `${importedFitnessFile.statusId}:${stravaActivityId}:strava-photos:send-update-note`
          ),
          name: SEND_UPDATE_NOTE_JOB_NAME,
          data: { actorId, statusId: importedFitnessFile.statusId }
        })
      } catch (error) {
        logger.error({
          message: 'Failed to queue the update for late Strava photos',
          actorId,
          stravaActivityId,
          statusId: importedFitnessFile.statusId,
          err: toLoggableError(error)
        })
      }
    }

    // The notification for this path now fires at the end of
    // processFitnessFileJob instead. Creating it here was premature: under
    // QStash that job is only enqueued at this point, so the route map and the
    // parsed stats do not exist yet and the email would arrive empty.
    // importFitnessFiles sets notifyOnComplete for a first import.

    // Only fall back to a regenerate-map job for a re-imported PRIMARY file
    // that still lacks a map. On a fresh import the primary is already handed
    // to processFitnessFileJob, so regenerating here would race that job; and a
    // file merged in as non-primary must never get its own map (it would render
    // as a second image on the shared post). `isPrimary` defaults to true for
    // older rows, so only an explicit `false` is treated as non-primary.
    if (
      !isNewImport &&
      importedFitnessFile.isPrimary !== false &&
      !importedFitnessFile.hasMapData
    ) {
      await getQueue().publish({
        id: getHashFromString(
          `${importedFitnessFile.statusId}:${importedFitnessFile.id}:regenerate-map`
        ),
        name: REGENERATE_FITNESS_MAPS_JOB_NAME,
        data: {
          actorId,
          fitnessFileIds: [importedFitnessFile.id]
        }
      })
    }
  }
)

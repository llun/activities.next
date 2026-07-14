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
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  REGENERATE_FITNESS_MAPS_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { withImportLock } from '@/lib/services/fitness-files/importLock'
import { MAX_ATTACHMENTS } from '@/lib/services/medias/constants'
import { saveMedia } from '@/lib/services/medias/index'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { getQueue } from '@/lib/services/queue'
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
import { Status, StatusType } from '@/lib/types/domain/status'
import { Visibility } from '@/lib/types/mastodon/visibility'
import { getManufacturerKeyFromDeviceName } from '@/lib/utils/fitnessDeviceBrands'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import {
  SAFE_DOWNLOAD_MAX_BYTES,
  readResponseArrayBufferWithLimit
} from '@/lib/utils/streamLimit'

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
  visibility: Visibility.optional()
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

const getActivityImportGroupKey = (
  actorId: string,
  activityStartDate?: string
) => {
  const dateStr = activityStartDate
    ? activityStartDate.slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  return `activity_import:${actorId}:${dateStr}`
}

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
}) => {
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
    return
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
    } catch (error) {
      const nodeError = error as Error
      logger.warn({
        message: 'Failed to store Strava photo as attachment',
        actorId,
        stravaActivityId,
        error: nodeError.message
      })
    }
  }
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
    const { actorId, stravaActivityId, stravaAuth, visibility } = JobData.parse(
      message.data
    )

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

        await getQueue().publish({
          id: getHashFromString(`${actorId}:strava-note:${stravaActivityId}`),
          name: SEND_NOTE_JOB_NAME,
          data: { actorId, statusId: createdNote.id }
        })

        if (isNewFallback) {
          await createNotificationWithPolicy(database, {
            actorId,
            type: 'activity_import',
            sourceActorId: actorId,
            statusId: createdNote.id,
            groupKey: getActivityImportGroupKey(actorId, activity.start_date)
          })
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
    }

    const isNewImport = !targetFitnessFile.statusId
    if (isNewImport) {
      // Serialize the post-creation critical section per actor. Strava delivers
      // one webhook per activity, so a single ride recorded on two devices
      // arrives as two activities at nearly the same moment and their imports
      // would otherwise run concurrently — each scanning for a sibling before
      // either has assigned a status, so each creates its own post (duplicate
      // same-ride posts). Holding the lock means the sibling's import has
      // already assigned its status by the time this one scans, so the overlap
      // merge in importFitnessFilesJob finds it and collapses both files into a
      // single post.
      await withImportLock(database, `strava-import:${actorId}`, async () => {
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

        await importFitnessFilesJob(database, {
          id: getHashFromString(`${actorId}:strava-import:${stravaActivityId}`),
          name: IMPORT_FITNESS_FILES_JOB_NAME,
          data: {
            actorId,
            batchId,
            fitnessFileIds: [targetFitnessFile.id],
            overlapFitnessFileIds,
            visibility: resolvedVisibility
          }
        })
      })
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

    await attachStravaPhotosToStatus({
      database,
      actor,
      actorId,
      statusId: importedFitnessFile.statusId,
      stravaActivityId,
      accessToken,
      activity
    })

    if (isNewImport) {
      await createNotificationWithPolicy(database, {
        actorId,
        type: 'activity_import',
        sourceActorId: actorId,
        statusId: importedFitnessFile.statusId,
        groupKey: getActivityImportGroupKey(actorId, activity.start_date)
      })
    }

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

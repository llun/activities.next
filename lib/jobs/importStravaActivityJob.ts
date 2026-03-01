import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { z } from 'zod'

import {
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { Database } from '@/lib/database/types'
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
import {
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { MAX_ATTACHMENTS } from '@/lib/services/medias/constants'
import { saveMedia } from '@/lib/services/medias/index'
import { getQueue } from '@/lib/services/queue'
import {
  StravaActivity,
  buildGpxFromStravaStreams,
  buildStravaActivitySummary,
  downloadStravaActivityFile,
  getStravaActivity,
  getStravaActivityDurationSeconds,
  getStravaActivityPhotos,
  getStravaActivityStartTimeMs,
  getStravaActivityStreams,
  getStravaUpload,
  getValidStravaAccessToken,
  isSupportedStravaPhotoMimeType,
  mapStravaVisibilityToMastodon
} from '@/lib/services/strava/activity'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { Actor, getMention } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

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
    .optional()
})

const OVERLAP_CONTEXT_SCAN_LIMIT = 200
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

const getStravaBatchId = (stravaActivityId: string) =>
  `strava-activity:${stravaActivityId}`

const getStravaFallbackPostId = ({
  actorId,
  stravaActivityId
}: {
  actorId: string
  stravaActivityId: string
}) => {
  return getHashFromString(`${actorId}:strava-note:${stravaActivityId}`)
}

const getOverlapContextFitnessFileIds = ({
  actorId,
  fitnessFileId,
  activityStartTime,
  activityDurationSeconds,
  files
}: {
  actorId: string
  fitnessFileId: string
  activityStartTime?: number
  activityDurationSeconds: number
  files: Array<
    Pick<
      FitnessFile,
      | 'id'
      | 'actorId'
      | 'statusId'
      | 'activityStartTime'
      | 'totalDurationSeconds'
    >
  >
}) => {
  const sameActorFiles = files.filter(
    (
      file
    ): file is Pick<
      FitnessFile,
      | 'id'
      | 'actorId'
      | 'statusId'
      | 'activityStartTime'
      | 'totalDurationSeconds'
    > & {
      statusId: string
      activityStartTime: number
      totalDurationSeconds: number
    } =>
      file.actorId === actorId &&
      file.id !== fitnessFileId &&
      typeof file.statusId === 'string' &&
      typeof file.activityStartTime === 'number' &&
      typeof file.totalDurationSeconds === 'number' &&
      file.totalDurationSeconds > 0
  )

  if (
    typeof activityStartTime !== 'number' ||
    !Number.isFinite(activityStartTime) ||
    activityDurationSeconds <= 0
  ) {
    return sameActorFiles.map((file) => file.id)
  }

  // Keep overlap candidates close to the new activity's start time.
  const shortPeriodWindowMs = Math.max(
    activityDurationSeconds * 1000 * 2,
    60 * 60 * 1000
  )

  return sameActorFiles
    .filter((file) => {
      const existingStartTime = file.activityStartTime
      return (
        Math.abs(existingStartTime - activityStartTime) <= shortPeriodWindowMs
      )
    })
    .map((file) => file.id)
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

      const buffer = await photoResponse.arrayBuffer()
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
  stravaActivityId
}: {
  database: Database
  actor: Actor
  activity: StravaActivity
  stravaActivityId: string
}): Promise<Status> => {
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
    return existingStatus
  }

  const visibility = mapStravaVisibilityToMastodon(activity.visibility)
  const text = buildStravaActivitySummary(activity)
  const to = statusRecipientsTo(actor, [], null, visibility)
  const cc = statusRecipientsCC(actor, [], null, visibility)

  try {
    return await database.createNote({
      id: statusId,
      url: `https://${actor.domain}/${getMention(actor)}/${postId}`,
      actorId: actor.id,
      text,
      summary: null,
      to,
      cc,
      reply: ''
    })
  } catch (error) {
    const duplicateStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    if (duplicateStatus) {
      return duplicateStatus
    }

    throw error
  }
}

export const importStravaActivityJob = createJobHandle(
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  async (database, message) => {
    const { actorId, stravaActivityId, stravaAuth } = JobData.parse(
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
    const batchId = getStravaBatchId(stravaActivityId)

    const batchFiles = await database.getFitnessFilesByBatchId({ batchId })
    let targetFitnessFile =
      batchFiles.find((file) => file.actorId === actorId) ?? null

    if (!targetFitnessFile) {
      let shouldDownload = Boolean(activity.upload_id)

      if (activity.upload_id) {
        const upload = await getStravaUpload({
          uploadId: activity.upload_id,
          accessToken
        })
        if (upload?.error) {
          logger.warn({
            message:
              'Strava upload has error, creating note from activity data',
            actorId,
            stravaActivityId,
            uploadError: upload.error
          })
          shouldDownload = false
        } else if (upload !== null && !upload.activity_id) {
          throw new Error(
            `Strava upload ${activity.upload_id} is still being processed`
          )
        }
      }

      let exportFile = shouldDownload
        ? await downloadStravaActivityFile({
            activityId: stravaActivityId,
            accessToken
          })
        : null

      if (!exportFile && !activity.upload_id) {
        const streams = await getStravaActivityStreams({
          activityId: stravaActivityId,
          accessToken
        })
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

      if (!exportFile && shouldDownload) {
        throw new Error(
          `Strava activity ${stravaActivityId} export not yet available, retrying`
        )
      }

      if (!exportFile) {
        logger.info({
          message:
            'No exportable file for Strava activity, creating note from activity data',
          actorId,
          stravaActivityId
        })

        const createdNote = await getOrCreateStravaFallbackNote({
          database,
          actor,
          activity,
          stravaActivityId
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

        return
      }

      const storedFitnessFile = await saveFitnessFile(database, actor, {
        file: exportFile,
        description: activity.description?.trim() || undefined,
        importBatchId: batchId
      })

      if (!storedFitnessFile) {
        throw new Error(
          'Failed to store Strava activity export as a fitness file'
        )
      }

      targetFitnessFile = await database.getFitnessFile({
        id: storedFitnessFile.id
      })
      if (!targetFitnessFile) {
        throw new Error('Stored Strava fitness file was not found in database')
      }
    }

    if (!targetFitnessFile.statusId) {
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
          visibility: mapStravaVisibilityToMastodon(activity.visibility)
        }
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
  }
)

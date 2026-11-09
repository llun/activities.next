import { Database } from '@/lib/database/types'
import { getSavedMediaAttachmentMetadata } from '@/lib/services/medias/attachmentMediaMetadata'
import { MAX_IMPORTED_ACTIVITY_ATTACHMENTS } from '@/lib/services/medias/constants'
import { getStoredMediaExtension } from '@/lib/services/medias/fileName'
import { saveMedia } from '@/lib/services/medias/index'
import {
  StravaActivity,
  getStravaActivityPhotos,
  isSupportedStravaPhotoMimeType
} from '@/lib/services/strava/activity'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'
import {
  SAFE_DOWNLOAD_MAX_BYTES,
  readResponseArrayBufferWithLimit
} from '@/lib/utils/streamLimit'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export const MAX_STRAVA_PHOTOS_TO_ATTACH = 4

const getAttachmentName = (photoId: string | undefined, index: number) => {
  return photoId ? `Strava photo ${photoId}` : `Strava photo ${index + 1}`
}

// The same content-type map the upload paths use, so a WebP/GIF/AVIF photo is
// named for what it is instead of every non-PNG becoming `.jpg`.
const getPhotoFileExtension = (mimeType: string) =>
  getStoredMediaExtension(mimeType, '').replace(/^\./, '')

// Returns how many photos it attached and the Strava ids of every photo seen on
// the status so far (`skipPhotoIds` included), which a later re-check passes
// back as `skipPhotoIds` so it never re-adds a photo the owner removed.
export const attachStravaPhotosToStatus = async ({
  database,
  actor,
  actorId,
  statusId,
  stravaActivityId,
  accessToken,
  activity,
  skipPhotoIds
}: {
  database: Database
  actor: Actor
  actorId: string
  statusId: string
  stravaActivityId: string
  accessToken: string
  activity: StravaActivity
  skipPhotoIds?: string[]
}): Promise<{ attachedCount: number; seenPhotoIds: string[] }> => {
  let attachedCount = 0
  const seenPhotoIds = new Set(skipPhotoIds ?? [])
  const existingAttachments = await database.getAttachments({ statusId })
  const attachmentNames = new Set(
    existingAttachments
      .map((attachment) => attachment.name ?? '')
      .filter((name) => name.length > 0)
  )
  const remainingAttachmentSlots = Math.max(
    0,
    MAX_IMPORTED_ACTIVITY_ATTACHMENTS - existingAttachments.length
  )

  if (remainingAttachmentSlots <= 0) {
    return { attachedCount, seenPhotoIds: [...seenPhotoIds] }
  }

  const photos = await getStravaActivityPhotos({
    activityId: stravaActivityId,
    accessToken,
    activity,
    limit: MAX_STRAVA_PHOTOS_TO_ATTACH
  })

  for (const photo of photos) {
    if (photo.id && attachmentNames.has(getAttachmentName(photo.id, 0))) {
      seenPhotoIds.add(photo.id)
    }
  }

  // Seen photos count against the Strava cap even once removed, so the import
  // and its re-checks together never attach more than four.
  const remainingStravaSlots = Math.min(
    remainingAttachmentSlots,
    MAX_STRAVA_PHOTOS_TO_ATTACH - seenPhotoIds.size
  )
  // `index` stays the photo's place in Strava's list: an id-less photo is
  // named by it, so filtering must not shift it.
  for (const { photo, index } of photos
    .map((photo, index) => ({ photo, index }))
    // A re-check cannot tell an id-less photo the owner removed from a new
    // one, so it only attaches photos Strava gave an id.
    .filter(({ photo }) =>
      photo.id ? !seenPhotoIds.has(photo.id) : skipPhotoIds === undefined
    )
    .slice(0, Math.max(0, remainingStravaSlots))) {
    const attachmentName = getAttachmentName(photo.id, index)
    if (attachmentNames.has(attachmentName)) {
      continue
    }

    try {
      // `safeImageFetch` re-runs the URL guard on every redirect hop. A bare
      // `fetch` follows redirects by default, so guarding only `photo.url`
      // left the request that actually went out unchecked.
      const photoResponse = await safeImageFetch(photo.url)
      if (!photoResponse) {
        logger.warn({
          message: 'Skipping Strava photo: download refused',
          actorId,
          stravaActivityId,
          photoUrl: photo.url
        })
        continue
      }

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
        mediaId: storedMedia.id,
        ...getSavedMediaAttachmentMetadata(storedMedia)
      })
      attachmentNames.add(attachmentName)
      if (photo.id) seenPhotoIds.add(photo.id)
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

  return { attachedCount, seenPhotoIds: [...seenPhotoIds] }
}

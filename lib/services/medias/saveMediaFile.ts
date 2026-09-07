import { Database } from '@/lib/database/types'
import { MediaValidationError } from '@/lib/services/medias/errors'
import { sanitizeStoredFileName } from '@/lib/services/medias/fileName'
import { getMediaAttachment } from '@/lib/services/medias/getMediaAttachment'
import {
  checkQuotaAvailable,
  getUploadQuotaReservation
} from '@/lib/services/medias/quota'
import { readValidThumbnail } from '@/lib/services/medias/thumbnailInput'
import {
  MediaSchema,
  MediaStorageSaveFileOutput
} from '@/lib/services/medias/types'
import { Actor } from '@/lib/types/domain/actor'

export interface SavedOriginalMedia {
  path: string
  metaData: {
    width?: number
    height?: number
  }
  previewImage?: Buffer | null
  blurhash?: string | null
  focus?: { x: number; y: number } | null
}

export interface SavedThumbnail {
  path: string
  outputInfo: {
    size: number
    width?: number
    height?: number
  }
  contentType: string
}

export interface MediaSaveDriver {
  saveVideoFile(
    file: File,
    options: { manualFocus?: { x: number; y: number } | null }
  ): Promise<SavedOriginalMedia>
  saveImageFile(
    file: File,
    options: { manualFocus?: { x: number; y: number } | null }
  ): Promise<SavedOriginalMedia>
  saveThumbnailBuffer(buffer: Buffer): Promise<SavedThumbnail>
  deleteFile(path: string): Promise<boolean>
  reclaimStored?(originalPath: string, thumbnailPath?: string): Promise<void>
}

export interface SaveMediaFileParams {
  database: Database
  host: string
  actor: Actor
  media: MediaSchema
  driver: MediaSaveDriver
}

export const reclaimStoredMedia = async (
  deleteFile: (filePath: string) => Promise<boolean>,
  originalPath: string,
  thumbnailPath?: string
): Promise<void> => {
  await Promise.all(
    [originalPath, thumbnailPath]
      .filter((stored): stored is string => stored !== undefined)
      .map((stored) => deleteFile(stored).catch(() => false))
  )
}

export const saveMediaFile = async ({
  database,
  host,
  actor,
  media,
  driver
}: SaveMediaFileParams): Promise<MediaStorageSaveFileOutput | null> => {
  const { file } = media
  if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
    return null
  }

  // Read and validate the thumbnail before anything is written, so unusable
  // bytes cannot leave a stored original behind.
  const thumbnailBuffer = media.thumbnail
    ? await readValidThumbnail(media.thumbnail)
    : null

  // Check quota before saving; see `getUploadQuotaReservation` for why the
  // thumbnail's share of it is an estimate.
  const quotaCheck = await checkQuotaAvailable(
    database,
    actor,
    getUploadQuotaReservation(media)
  )
  if (!quotaCheck.available) {
    throw new MediaValidationError(
      `Storage quota exceeded. Used: ${quotaCheck.used} bytes, Limit: ${quotaCheck.limit} bytes`
    )
  }

  const { path, metaData, previewImage, blurhash, focus } =
    file.type.startsWith('video')
      ? await driver.saveVideoFile(file, { manualFocus: media.focus })
      : await driver.saveImageFile(file, { manualFocus: media.focus })

  const reclaim = (originalPath: string, thumbnailPath?: string) =>
    driver.reclaimStored
      ? driver.reclaimStored(originalPath, thumbnailPath)
      : reclaimStoredMedia(
          driver.deleteFile.bind(driver),
          originalPath,
          thumbnailPath
        )

  // A caller-supplied thumbnail wins; a video otherwise falls back to the
  // frame extracted from it. `previewImage` is null for an image upload — a video
  // whose frame cannot be decoded rejects rather than resolving null.
  const thumbnailSource = thumbnailBuffer ?? previewImage
  let thumbnail: SavedThumbnail | null
  try {
    thumbnail = thumbnailSource
      ? await driver.saveThumbnailBuffer(thumbnailSource)
      : null
  } catch (error) {
    // The thumbnail's bytes were validated above, so this is a storage fault
    // of ours: keep the error — it has to stay a logged 500, not a 422 the
    // client will not retry — but put the original back first.
    await reclaim(path)
    throw error
  }

  let storedMedia
  try {
    storedMedia = await database.createMedia({
      actorId: actor.id,
      original: {
        path,
        bytes: file.size,
        mimeType: file.type,
        metaData: {
          width: metaData.width ?? 0,
          height: metaData.height ?? 0
        },
        fileName: sanitizeStoredFileName(file.name)
      },
      ...(thumbnail
        ? {
            // Use the resized image's actual size/dimensions (outputInfo), not
            // the input image's metadata.
            thumbnail: {
              path: thumbnail.path,
              bytes: thumbnail.outputInfo.size,
              mimeType: thumbnail.contentType,
              metaData: {
                width: thumbnail.outputInfo.width ?? 0,
                height: thumbnail.outputInfo.height ?? 0
              }
            }
          }
        : null),
      ...(media.description ? { description: media.description } : null),
      ...(focus ? { focus } : null),
      ...(blurhash ? { blurhash } : null)
    })
  } catch (error) {
    await reclaim(path, thumbnail?.path)
    throw error
  }

  if (!storedMedia) {
    await reclaim(path, thumbnail?.path)
    throw new Error('Fail to store media')
  }

  return getMediaAttachment(storedMedia, host)
}

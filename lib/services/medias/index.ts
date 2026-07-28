import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import {
  PresignedUploadValidationError,
  S3FileStorage
} from '@/lib/services/medias/S3StorageFile'
import type { ImageOutputFormat } from '@/lib/services/medias/imageOutputFormat'
import { LocalFileStorage } from '@/lib/services/medias/localFile'
import { MediaSchema, PresigedMediaInput } from '@/lib/services/medias/types'
import { Actor } from '@/lib/types/domain/actor'

export { PresignedUploadValidationError }

export const saveMedia = async (
  database: Database,
  actor: Actor,
  media: MediaSchema
) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile: {
      return LocalFileStorage.getStorage(mediaStorage, host, database).saveFile(
        actor,
        media
      )
    }
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(mediaStorage, host, database).saveFile(
        actor,
        media
      )
    }
    default:
      return null
  }
}

export const saveMediaThumbnail = async (
  database: Database,
  actor: Actor,
  file: File
) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile: {
      return LocalFileStorage.getStorage(
        mediaStorage,
        host,
        database
      ).saveThumbnail(actor, file)
    }
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(
        mediaStorage,
        host,
        database
      ).saveThumbnail(actor, file)
    }
    default:
      return null
  }
}

/**
 * Stores an extra encoding of an image without registering a `medias` row.
 *
 * The caller owns the returned path — nothing else references it — so only use
 * this where the path is recorded somewhere durable. Today that is the fitness
 * route map's JPEG twin, kept for mail clients with no WebP decoder and
 * recorded on `fitness_files.mapImageEmailPath`.
 */
export const saveMediaImageRendition = async (
  database: Database,
  actor: Actor,
  file: File,
  format: ImageOutputFormat
) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile: {
      return LocalFileStorage.getStorage(
        mediaStorage,
        host,
        database
      ).saveImageRendition(actor, file, format)
    }
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(
        mediaStorage,
        host,
        database
      ).saveImageRendition(actor, file, format)
    }
    default:
      return null
  }
}

export const getPresignedUrl = async (
  database: Database,
  actor: Actor,
  presignedMediaInput: PresigedMediaInput
) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(
        mediaStorage,
        host,
        database
      ).getPresigedForSaveFileUrl(actor, presignedMediaInput)
    }
    default:
      return null
  }
}

export const completePresignedMediaUpload = async (
  database: Database,
  actor: Actor,
  mediaId: string
) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(
        mediaStorage,
        host,
        database
      ).completePresignedUpload(actor, mediaId)
    }
    default:
      return null
  }
}

export const getMedia = async (database: Database, path: string) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile: {
      return LocalFileStorage.getStorage(mediaStorage, host, database).getFile(
        path
      )
    }
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(mediaStorage, host, database).getFile(
        path
      )
    }
    default:
      return null
  }
}

export const deleteMediaFile = async (database: Database, path: string) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile: {
      return LocalFileStorage.getStorage(
        mediaStorage,
        host,
        database
      ).deleteFile(path)
    }
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(mediaStorage, host, database).deleteFile(
        path
      )
    }
    default:
      return false
  }
}

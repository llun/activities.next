import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import {
  PresignedUploadValidationError,
  S3FileStorage
} from '@/lib/services/medias/S3StorageFile'
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

export const saveMediaThumbnail = async (database: Database, file: File) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile: {
      return LocalFileStorage.getStorage(
        mediaStorage,
        host,
        database
      ).saveThumbnail(file)
    }
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(
        mediaStorage,
        host,
        database
      ).saveThumbnail(file)
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

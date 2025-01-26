import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Storage } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { S3FileStorage } from '@/lib/services/medias/S3StorageFile'
import { LocalFileStorage } from '@/lib/services/medias/localFile'
import { MediaSchema, PresigedMediaInput } from '@/lib/services/medias/types'

export const saveMedia = async (
  storage: Storage,
  actor: Actor,
  media: MediaSchema
) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile: {
      return LocalFileStorage.getStorage(mediaStorage, host, storage).saveFile(
        actor,
        media
      )
    }
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(mediaStorage, host, storage).saveFile(
        actor,
        media
      )
    }
    default:
      return null
  }
}

export const getPresignedUrl = async (
  storage: Storage,
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
        storage
      ).getPresigedForSaveFileUrl(actor, presignedMediaInput)
    }
    default:
      return null
  }
}

export const getMedia = async (storage: Storage, path: string) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile: {
      return LocalFileStorage.getStorage(mediaStorage, host, storage).getFile(
        path
      )
    }
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(mediaStorage, host, storage).getFile(path)
    }
    default:
      return null
  }
}

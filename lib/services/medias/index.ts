import { Storage } from '@/lib/storage/types'

import { getConfig } from '../../config'
import { MediaStorageType } from '../../config/mediaStorage'
import { Actor } from '../../models/actor'
import { LocalFileStorage } from './localFile'
import { S3FileStorage } from './objectStorageFile'
import { MediaSchema } from './types'

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

export const getMedia = async (storage: Storage, path: string) => {
  const { mediaStorage, host } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile: {
      return LocalFileStorage.getStorage(mediaStorage, host, storage).getFile(
        path
      )
    }
    case MediaStorageType.ObjectStorage: {
      return S3FileStorage.getStorage(mediaStorage, host, storage).getFile(path)
    }
    default:
      return null
  }
}

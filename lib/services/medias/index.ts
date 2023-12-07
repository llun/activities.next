import { getConfig } from '../../config'
import { MediaStorageType } from '../../config/mediaStorage'
import { Actor } from '../../models/actor'
import { Storage } from '../../storage/types'
import { getLocalFile, saveLocalFile } from './localFile'
import {
  getObjectStorageFile,
  saveObjectStorageFile
} from './objectStorageFile'
import { MediaSchema } from './types'

export const saveMedia = async (
  storage: Storage,
  actor: Actor,
  media: MediaSchema
) => {
  const { mediaStorage, host } = getConfig()
  if (!mediaStorage) return null
  switch (mediaStorage.type) {
    case MediaStorageType.LocalFile:
      return saveLocalFile(mediaStorage, host, storage, actor, media)
    case MediaStorageType.ObjectStorage:
      return saveObjectStorageFile(mediaStorage, host, storage, actor, media)
    default:
      return null
  }
}

export const getMedia = async (path: string) => {
  const { mediaStorage } = getConfig()
  if (!mediaStorage) return null
  switch (mediaStorage.type) {
    case MediaStorageType.LocalFile:
      return getLocalFile(mediaStorage, path)
    case MediaStorageType.ObjectStorage:
      return getObjectStorageFile(mediaStorage, path)
    default:
      return null
  }
}

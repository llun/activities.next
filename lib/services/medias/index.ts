import { getConfig } from '../../config'
import { MediaStorageType } from '../../config/mediaStorage'
import { Actor } from '../../models/actor'
import { Storage } from '../../storage/types'
import { MediaSchema } from './constants'
import { saveLocalFile } from './localFile'
import { saveObjectStorageFile } from './objectStorageFile'

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

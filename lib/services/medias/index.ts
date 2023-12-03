import { getConfig } from '../../config'
import { MediaStorageType } from '../../config/mediaStorage'
import { Actor } from '../../models/actor'
import { Storage } from '../../storage/types'
import { MediaSchema } from './constants'
import { saveLocalFile } from './localFile'

export const saveMedia = async (
  storage: Storage,
  actor: Actor,
  media: MediaSchema
) => {
  const { mediaStorage } = getConfig()
  if (!mediaStorage) return null
  switch (mediaStorage.type) {
    case MediaStorageType.LocalFile:
      return saveLocalFile(storage, actor, media)
    default:
      return null
  }
}

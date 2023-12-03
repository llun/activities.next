import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import crypto from 'crypto'

import { getConfig } from '../../config'
import { MediaStorageType } from '../../config/mediaStorage'
import { Actor } from '../../models/actor'
import { Storage } from '../../storage/types'
import { MediaSchema } from './constants'

export const saveObjectStorageFile = async (
  storage: Storage,
  actor: Actor,
  media: MediaSchema
) => {
  const { mediaStorage } = getConfig()
  if (mediaStorage?.type !== MediaStorageType.ObjectStorage) return null

  const randomPrefix = crypto.randomBytes(8).toString('hex')
  const s3client = new S3Client()
  const command = new PutObjectCommand({
    Bucket: mediaStorage.bucket,
    Key: `medias/${randomPrefix}-${media.file.name}`,
    Body: media.file.stream()
  })
  await s3client.send(command)
  return null
}

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import crypto from 'crypto'
import format from 'date-fns-tz/format'

import {
  MediaStorageObjectConfig,
  MediaStorageType
} from '../../config/mediaStorage'
import { MediaStorageService } from './constants'

const uploadFileToS3 = async (
  currentTime: number,
  mediaStorageConfig: MediaStorageObjectConfig,
  file: File
) => {
  const { bucket, region } = mediaStorageConfig
  const randomPrefix = crypto.randomBytes(8).toString('hex')
  const timeDirectory = format(currentTime, 'yyyy-MM-dd')
  const s3client = new S3Client({ region })
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: `medias/${timeDirectory}/${randomPrefix}-${file.name}`,
    Body: Buffer.from(await file.arrayBuffer())
  })
  return await s3client.send(command)
}

export const saveObjectStorageFile: MediaStorageService = async (
  config,
  host,
  storage,
  actor,
  media
) => {
  if (config.type !== MediaStorageType.ObjectStorage) return null

  const currentTime = Date.now()
  await uploadFileToS3(currentTime, config, media.file)
  return null
}

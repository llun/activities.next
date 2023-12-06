import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import crypto from 'crypto'
import format from 'date-fns-tz/format'
import { IncomingMessage } from 'http'
import { memoize } from 'lodash'
import shape from 'sharp'

import {
  MediaStorageObjectConfig,
  MediaStorageType
} from '../../config/mediaStorage'
import {
  MAX_HEIGHT,
  MAX_WIDTH,
  MediaStorageGetFile,
  MediaStorageSaveFile
} from './constants'

const getS3Client = memoize((region: string) => new S3Client({ region }))

const uploadFileToS3 = async (
  currentTime: number,
  mediaStorageConfig: MediaStorageObjectConfig,
  file: File
) => {
  const { bucket, region } = mediaStorageConfig
  const randomPrefix = crypto.randomBytes(8).toString('hex')

  const resizedImage = shape(Buffer.from(await file.arrayBuffer()))
    .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside' })
    .rotate()
    .jpeg({ quality: 90 })

  const [metaData, buffer] = await Promise.all([
    resizedImage.metadata(),
    resizedImage.toBuffer()
  ])

  const contentType = 'image/jpeg'
  const timeDirectory = format(currentTime, 'yyyy-MM-dd')
  const path = `medias/${timeDirectory}/${randomPrefix}.jpg`
  const s3client = getS3Client(region)
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: path,
    ContentType: contentType,
    Body: buffer
  })
  await s3client.send(command)
  return { image: resizedImage, metaData, path, contentType }
}

export const saveObjectStorageFile: MediaStorageSaveFile = async (
  config,
  host,
  storage,
  actor,
  media
) => {
  if (config.type !== MediaStorageType.ObjectStorage) return null
  // TODO: Support video later
  if (!media.file.type.startsWith('image')) return null

  const { file } = media
  const currentTime = Date.now()
  const { metaData, path } = await uploadFileToS3(currentTime, config, file)
  const storedMedia = await storage.createMedia({
    actorId: actor.id,
    original: {
      path,
      bytes: media.file.size,
      mimeType: media.file.type,
      metaData: {
        width: metaData.width ?? 0,
        height: metaData.height ?? 0
      }
    },
    ...(media.description ? { description: media.description } : null)
  })
  if (!storedMedia) {
    throw new Error('Fail to store media')
  }
  return {
    id: storedMedia.id,
    type: media.file.type.startsWith('image') ? 'image' : 'video',
    mime_type: media.file.type,
    // TODO: Add config for base image domain?
    url: `https://${host}/api/v1/files/${storedMedia.original.path}`,
    preview_url: `https://${host}/api/v1/files/${storedMedia.original.path}`,
    text_url: '',
    remote_url: '',
    meta: {
      original: {
        width: storedMedia.original.metaData.width,
        height: storedMedia.original.metaData.height,
        size: `${storedMedia.original.metaData.width}x${storedMedia.original.metaData.height}`,
        aspect:
          storedMedia.original.metaData.width /
          storedMedia.original.metaData.height
      },
      ...(storedMedia.thumbnail
        ? {
            small: {
              width: storedMedia.thumbnail.metaData.width,
              height: storedMedia.thumbnail.metaData.height,
              size: `${storedMedia.thumbnail.metaData.width}x${storedMedia.thumbnail.metaData.height}`,
              aspect:
                storedMedia.thumbnail.metaData.width /
                storedMedia.thumbnail.metaData.height
            }
          }
        : null)
    },
    description: media?.description ?? ''
  }
}

export const getObjectStorageFile: MediaStorageGetFile = async (
  config,
  path
) => {
  if (config.type !== MediaStorageType.ObjectStorage) return null

  const { bucket, region } = config
  const s3client = getS3Client(region)
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: path
  })
  const object = await s3client.send(command)
  if (!object.Body) return null

  const message = object.Body
  return {
    contentType: (message as IncomingMessage).headers['content-type'] as string,
    buffer: Buffer.from(await message.transformToByteArray())
  }
}

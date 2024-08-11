import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import crypto from 'crypto'
import { format } from 'date-fns'
import fs from 'fs/promises'
import { IncomingMessage } from 'http'
import { memoize } from 'lodash'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'

import {
  MediaStorageObjectConfig,
  MediaStorageType
} from '../../config/mediaStorage'
import { Media } from '../../storage/types/media'
import { MAX_HEIGHT, MAX_WIDTH } from './constants'
import { extractVideoMeta } from './extractVideoMeta'
import {
  MediaStorageGetFile,
  MediaStorageSaveFile,
  MediaStorageSaveFileOutput
} from './types'

const getS3Client = memoize((region: string) => new S3Client({ region }))

const uploadImageToS3 = async (
  currentTime: number,
  mediaStorageConfig: MediaStorageObjectConfig,
  file: File
) => {
  const { bucket, region } = mediaStorageConfig
  const randomPrefix = crypto.randomBytes(8).toString('hex')

  const resizedImage = sharp(Buffer.from(await file.arrayBuffer()))
    .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside' })
    .rotate()
    .webp({ quality: 95, smartSubsample: true, nearLossless: true })

  const tempFilePath = join(
    tmpdir(),
    `${crypto.randomBytes(8).toString('hex')}.webp`
  )
  const [metaData] = await Promise.all([
    resizedImage.metadata(),
    resizedImage.keepExif().toFile(tempFilePath)
  ])

  const contentType = 'image/webp'
  const timeDirectory = format(currentTime, 'yyyy-MM-dd')
  const path = `medias/${timeDirectory}/${randomPrefix}.webp`
  const s3client = getS3Client(region)

  const fd = await fs.open(tempFilePath, 'r')
  const stream = fd.createReadStream()
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: path,
    ContentType: contentType,
    Body: stream
  })
  await s3client.send(command)
  stream.close()
  fd.close()
  return { image: resizedImage, metaData, path, contentType }
}

const uploadVideoToS3 = async (
  currentTime: number,
  mediaStorageConfig: MediaStorageObjectConfig,
  file: File
) => {
  const buffer = Buffer.from(await file.arrayBuffer())
  const probe = await extractVideoMeta(buffer)
  const videoStream = probe.streams.find(
    (stream) => stream.codec_type === 'video'
  )
  const formats = probe.format.format_name?.split(',')
  if (
    !videoStream ||
    !(formats?.includes('mp4') || formats?.includes('webm'))
  ) {
    throw new Error('Invalid video format')
  }

  const metaData = videoStream
    ? { width: videoStream.width, height: videoStream.height }
    : { width: 0, height: 0 }

  const { bucket, region } = mediaStorageConfig
  const randomPrefix = crypto.randomBytes(8).toString('hex')
  const timeDirectory = format(currentTime, 'yyyy-MM-dd')
  const fileName = file.name.endsWith('.mov')
    ? `${file.name.split('.')[0]}.mp4`
    : file.name
  const path = `medias/${timeDirectory}/${randomPrefix}-${fileName}`
  const s3client = getS3Client(region)
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: path,
    ContentType: file.type,
    Body: buffer
  })
  await s3client.send(command)
  return { path, metaData, contentType: file.type }
}

const getSaveFileOutput = (
  host: string,
  media: Media,
  contentType?: string
): MediaStorageSaveFileOutput => {
  const mimeType = contentType ?? media.original.mimeType
  const type = mimeType.startsWith('video') ? 'video' : 'image'
  return {
    id: media.id,
    type,
    mime_type: mimeType,
    // TODO: Add config for base image domain?
    url: `https://${host}/api/v1/files/${media.original.path}`,
    preview_url: `https://${host}/api/v1/files/${media.original.path}`,
    text_url: '',
    remote_url: '',
    meta: {
      original: {
        width: media.original.metaData.width,
        height: media.original.metaData.height,
        size: `${media.original.metaData.width}x${media.original.metaData.height}`,
        aspect: media.original.metaData.width / media.original.metaData.height
      },
      ...(media.thumbnail
        ? {
            small: {
              width: media.thumbnail.metaData.width,
              height: media.thumbnail.metaData.height,
              size: `${media.thumbnail.metaData.width}x${media.thumbnail.metaData.height}`,
              aspect:
                media.thumbnail.metaData.width / media.thumbnail.metaData.height
            }
          }
        : null)
    },
    description: media?.description ?? ''
  }
}

export const saveObjectStorageFile: MediaStorageSaveFile = async (
  config,
  host,
  storage,
  actor,
  media
) => {
  if (config.type !== MediaStorageType.ObjectStorage) return null

  const { file } = media
  const currentTime = Date.now()
  if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
    return null
  }

  if (file.type.startsWith('video')) {
    const { path, metaData, contentType } = await uploadVideoToS3(
      currentTime,
      config,
      file
    )
    const storedMedia = await storage.createMedia({
      actorId: actor.id,
      original: {
        path,
        bytes: file.size,
        mimeType: file.type,
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
    return getSaveFileOutput(host, storedMedia, contentType)
  }

  const { metaData, path } = await uploadImageToS3(currentTime, config, file)
  const storedMedia = await storage.createMedia({
    actorId: actor.id,
    original: {
      path,
      bytes: file.size,
      mimeType: file.type,
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
  return getSaveFileOutput(host, storedMedia)
}

export const getObjectStorageFile: MediaStorageGetFile = async (
  config,
  path
) => {
  if (config.type !== MediaStorageType.ObjectStorage) return null

  const { bucket, region, hostname } = config
  if (hostname) {
    return {
      type: 'redirect',
      redirectUrl: `https://${hostname}/${path}`
    }
  }

  const s3client = getS3Client(region)
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: path
  })
  const object = await s3client.send(command)
  if (!object.Body) return null

  const message = object.Body
  return {
    type: 'buffer',
    contentType: (message as IncomingMessage).headers['content-type'] as string,
    buffer: Buffer.from(await message.transformToByteArray())
  }
}

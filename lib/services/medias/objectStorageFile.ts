import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import crypto from 'crypto'
import { format } from 'date-fns'
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs/promises'
import { IncomingMessage } from 'http'
import { memoize } from 'lodash'
import { tmpdir } from 'os'
import { basename, extname, join } from 'path'
import sharp from 'sharp'

import {
  MediaStorageObjectConfig,
  MediaStorageType
} from '../../config/mediaStorage'
import { Media } from '../../storage/types/media'
import { MAX_HEIGHT, MAX_WIDTH } from './constants'
import { transcodeMedia } from './transcoder'
import {
  FFProbe,
  MediaStorageGetFile,
  MediaStorageSaveFile,
  MediaStorageSaveFileOutput,
  VideoProbe
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
  const inputPath = join(
    tmpdir(),
    `${Buffer.from(crypto.randomBytes(8)).toString('hex')}-${file.name}`
  )
  await fs.writeFile(inputPath, buffer)
  const [probe, outputBuffer] = await Promise.all([
    new Promise((resolve, reject) => {
      ffmpeg(inputPath).ffprobe((error, data) => {
        if (error) return reject(error)
        resolve(data)
      })
    }),
    transcodeMedia(inputPath)
  ])
  const videoStream = (probe as FFProbe).streams.find(
    (stream): stream is VideoProbe => stream.codec_type === 'video'
  )
  const metaData = videoStream
    ? { width: videoStream.width, height: videoStream.height }
    : { width: 0, height: 0 }

  const { bucket, region } = mediaStorageConfig
  const randomPrefix = crypto.randomBytes(8).toString('hex')
  const timeDirectory = format(currentTime, 'yyyy-MM-dd')
  const path = `medias/${timeDirectory}/${randomPrefix}-${basename(file.name, extname(file.name))}.webm`
  const s3client = getS3Client(region)
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: path,
    ContentType: 'video/webm',
    Body: outputBuffer
  })
  await s3client.send(command)
  return { path, metaData, contentType: 'video/webm' }
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

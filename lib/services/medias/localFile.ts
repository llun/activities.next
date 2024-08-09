import crypto from 'crypto'
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs/promises'
import mime from 'mime-types'
import path from 'path'
import process from 'process'
import sharp from 'sharp'
import { Readable } from 'stream'

import { MediaStorageType } from '@/lib/config/mediaStorage'

import { MAX_HEIGHT, MAX_WIDTH } from './constants'
import { extractVideoImage } from './extractVideoImage'
import {
  FFProbe,
  MediaStorageGetFile,
  MediaStorageSaveFile,
  VideoProbe
} from './types'

const saveImageFile = async (
  uploadPath: string,
  imageFile: File,
  isThumbnail: boolean
) =>
  saveImageBuffer(
    uploadPath,
    imageFile.name,
    Buffer.from(await imageFile.arrayBuffer()),
    isThumbnail
  )

const saveImageBuffer = async (
  uploadPath: string,
  fileName: string,
  imageBuffer: Buffer,
  isThumbnail: boolean
) => {
  const randomPrefix = crypto.randomBytes(8).toString('hex')
  const filePath = `${process.cwd()}/${uploadPath}/${randomPrefix}${isThumbnail ? '-thumbail' : ''}-${fileName}`
  const resizedImage = sharp(imageBuffer)
    .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside' })
    .rotate()
    .webp({ quality: 95, smartSubsample: true, nearLossless: true })
  const [metaData] = await Promise.all([
    resizedImage.metadata(),
    resizedImage.keepExif().toFile(filePath)
  ])

  return {
    image: resizedImage,
    metaData,
    path: filePath,
    contentType: 'image/webp',
    previewImage: null
  }
}

const saveVideoFile = async (uploadPath: string, videoFile: File) => {
  const buffer = Buffer.from(await videoFile.arrayBuffer())
  const [probe, previewImage] = await Promise.all([
    new Promise((resolve, reject) => {
      ffmpeg(Readable.from(buffer)).ffprobe((error, data) => {
        if (error) return reject(error)
        resolve(data)
      })
    }),
    extractVideoImage(Readable.from(buffer))
  ])

  const videoStream = (probe as FFProbe).streams.find(
    (stream): stream is VideoProbe => stream.codec_type === 'video'
  )
  const metaData = videoStream
    ? { width: videoStream.width, height: videoStream.height }
    : { width: 0, height: 0 }

  const randomPrefix = crypto.randomBytes(8).toString('hex')
  const filePath = `${process.cwd()}/${uploadPath}/${randomPrefix}-${videoFile.name}`
  await fs.writeFile(filePath, buffer)
  return {
    metaData,
    path: filePath,
    contentType: videoFile.type,
    previewImage
  }
}

export const saveLocalFile: MediaStorageSaveFile = async (
  config,
  host,
  storage,
  actor,
  media
) => {
  if (config.type !== MediaStorageType.LocalFile) return null

  const { file } = media
  if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
    return null
  }

  const { path, metaData, previewImage } = file.type.startsWith('video')
    ? await saveVideoFile(config.path, file)
    : await saveImageFile(config.path, file, false)
  const thumbnail = media.thumbnail
    ? await saveImageFile(config.path, media.thumbnail, true)
    : previewImage
      ? await saveImageBuffer(config.path, file.name, previewImage, true)
      : null
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
    ...(thumbnail
      ? {
          thumbnail: {
            path: thumbnail.path,
            bytes: thumbnail.metaData.size ?? 0,
            mimeType: `image/${thumbnail.metaData.format ?? 'jpg'}`,
            metaData: {
              width: thumbnail.metaData.width ?? 0,
              height: thumbnail.metaData.height ?? 0
            }
          }
        }
      : null),
    ...(media.description ? { description: media.description } : null)
  })

  if (!storedMedia) {
    throw new Error('Fail to store media')
  }

  const url = `https://${host}/api/v1/files/${storedMedia.original.path
    .split('/')
    .pop()}`

  return {
    id: storedMedia.id,
    type: media.file.type.startsWith('image') ? 'image' : 'video',
    mime_type: media.file.type,
    // TODO: Add config for base image domain?
    url,
    preview_url: url,
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

export const getLocalFile: MediaStorageGetFile = async (config, filePath) => {
  if (config.type !== MediaStorageType.LocalFile) return null

  const fullPath = path.resolve(config.path, filePath)
  const contentType = mime.contentType(path.extname(fullPath))
  if (!contentType) return null

  try {
    return {
      type: 'buffer',
      buffer: await fs.readFile(fullPath),
      contentType
    }
  } catch (e) {
    const error = e as NodeJS.ErrnoException
    console.error(error.message)
    console.error(error.stack)
    return null
  }
}

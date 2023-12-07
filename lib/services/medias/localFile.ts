import crypto from 'crypto'
import fs from 'fs/promises'
import mime from 'mime-types'
import path from 'path'
import sharp from 'sharp'

import { MediaStorageType } from '../../config/mediaStorage'
import { MediaStorageGetFile, MediaStorageSaveFile } from './types'

export const saveLocalFile: MediaStorageSaveFile = async (
  config,
  host,
  storage,
  actor,
  media
) => {
  if (config.type !== MediaStorageType.LocalFile) return null

  const randomPrefix = crypto.randomBytes(8).toString('hex')

  const filePath = `${config.path}/${randomPrefix}-${media.file.name}`
  const thumbnailPath = media.thumbnail
    ? `${config.path}/${randomPrefix}-${media.thumbnail.name}`
    : null

  await fs.writeFile(filePath, Buffer.from(await media.file.arrayBuffer()))
  if (thumbnailPath && media.thumbnail) {
    await fs.writeFile(
      thumbnailPath,
      Buffer.from(await media.thumbnail.arrayBuffer())
    )
  }

  const originalMetaData = await sharp(filePath).metadata()
  const thumbnailMetaData = thumbnailPath
    ? await sharp(thumbnailPath).metadata()
    : null

  const storedMedia = await storage.createMedia({
    actorId: actor.id,
    original: {
      path: filePath,
      bytes: media.file.size,
      mimeType: media.file.type,
      metaData: {
        width: originalMetaData.width ?? 0,
        height: originalMetaData.height ?? 0
      }
    },
    ...(thumbnailPath
      ? {
          thumbnail: {
            path: thumbnailPath,
            bytes: thumbnailMetaData?.size ?? 0,
            mimeType: `image/${thumbnailMetaData?.format}`,
            metaData: {
              width: thumbnailMetaData?.width ?? 0,
              height: thumbnailMetaData?.height ?? 0
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

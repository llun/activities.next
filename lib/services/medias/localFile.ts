import crypto from 'crypto'
import fs from 'fs/promises'
import mime from 'mime-types'
import path from 'path'
import process from 'process'
import sharp from 'sharp'

import { MediaStorageFileConfig } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { logger } from '@/lib/utils/logger'

import { MAX_HEIGHT, MAX_WIDTH } from './constants'
import { extractVideoImage } from './extractVideoImage'
import { extractVideoMeta } from './extractVideoMeta'
import { checkQuotaAvailable } from './quota'
import {
  MediaSchema,
  MediaStorage,
  MediaStorageGetFileOutput,
  MediaStorageSaveFileOutput,
  MediaType
} from './types'

export class LocalFileStorage implements MediaStorage {
  private static _instance: MediaStorage

  private _config: MediaStorageFileConfig
  private _host: string
  private _database: Database

  static getStorage(
    config: MediaStorageFileConfig,
    host: string,
    database: Database
  ) {
    if (!LocalFileStorage._instance) {
      LocalFileStorage._instance = new LocalFileStorage(config, host, database)
    }
    return LocalFileStorage._instance
  }

  constructor(
    config: MediaStorageFileConfig,
    host: string,
    database: Database
  ) {
    this._config = config
    this._host = host
    this._database = database
  }

  async getFile(filePath: string) {
    const fullPath = path.resolve(this._config.path, filePath)
    const contentType = mime.contentType(path.extname(fullPath))
    if (!contentType) return null

    try {
      return MediaStorageGetFileOutput.parse({
        type: 'buffer',
        buffer: await fs.readFile(fullPath),
        contentType
      })
    } catch (e) {
      const error = e as NodeJS.ErrnoException
      logger.error(error)
      return null
    }
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      const fullPath = path.resolve(this._config.path, filePath)
      await fs.unlink(fullPath)
      return true
    } catch (e) {
      const error = e as NodeJS.ErrnoException
      // If file doesn't exist, consider it already deleted (success)
      if (error.code === 'ENOENT') {
        return true
      }
      logger.error({
        message: 'Failed to delete file from local storage',
        filePath,
        error: error.message
      })
      return false
    }
  }

  isPresigedSupported() {
    return false
  }

  async getPresigedForSaveFileUrl() {
    // Local storage does not support presigned URLs
    return null
  }

  async saveFile(actor: Actor, media: MediaSchema) {
    const { file } = media
    if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
      return null
    }

    // Check quota before saving
    const quotaCheck = await checkQuotaAvailable(
      this._database,
      actor,
      file.size
    )
    if (!quotaCheck.available) {
      throw new Error(
        `Storage quota exceeded. Used: ${quotaCheck.used} bytes, Limit: ${quotaCheck.limit} bytes`
      )
    }

    const { path, metaData, previewImage } = file.type.startsWith('video')
      ? await this._saveVideoFile(file)
      : await this._saveImageFile(file, false)
    const thumbnail = media.thumbnail
      ? await this._saveImageFile(media.thumbnail, true)
      : previewImage
        ? await this._saveImageBuffer(`video-thumbnail.jpg`, previewImage, true)
        : null
    const storedMedia = await this._database.createMedia({
      actorId: actor.id,
      original: {
        path,
        bytes: file.size,
        mimeType: file.type,
        metaData: {
          width: metaData.width ?? 0,
          height: metaData.height ?? 0
        },
        fileName: file.name
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

    const protocol =
      this._host.startsWith('localhost') ||
      this._host.startsWith('127.0.0.1') ||
      this._host.startsWith('::1') ||
      this._host.startsWith('[::1]')
        ? 'http'
        : 'https'
    const url = `${protocol}://${this._host}/api/v1/files/${storedMedia.original.path}`

    const previewUrl = thumbnail
      ? `${protocol}://${this._host}/api/v1/files/${thumbnail?.path}`
      : url
    return MediaStorageSaveFileOutput.parse({
      id: `${storedMedia.id}`,
      type: media.file.type.startsWith('image')
        ? MediaType.enum.image
        : MediaType.enum.video,
      mime_type: media.file.type,
      // TODO: Add config for base image domain?
      url,
      preview_url: previewUrl,
      text_url: null,
      remote_url: null,
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
    })
  }

  private async _saveImageFile(imageFile: File, isThumbnail = false) {
    return this._saveImageBuffer(
      imageFile.name,
      Buffer.from(await imageFile.arrayBuffer()),
      isThumbnail
    )
  }

  private async _saveImageBuffer(
    fileName: string,
    imageBuffer: Buffer,
    isThumbnail = false
  ) {
    const uploadPath = this._config.path

    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const filename = `${randomPrefix}${isThumbnail ? '-thumbnail' : ''}.webp`
    const filePath = path.resolve(process.cwd(), uploadPath, filename)
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
      path: filename,
      contentType: 'image/webp',
      previewImage: null
    }
  }

  private async _saveVideoFile(videoFile: File) {
    const uploadPath = this._config.path
    const buffer = Buffer.from(await videoFile.arrayBuffer())
    const probe = await extractVideoMeta(Buffer.from(buffer))
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

    const ext = videoFile.name.endsWith('.mov')
      ? '.mp4'
      : path.extname(videoFile.name)

    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const filename = `${randomPrefix}${ext}`
    const filePath = path.resolve(process.cwd(), uploadPath, filename)
    await fs.writeFile(filePath, buffer)
    const previewImage = await extractVideoImage(filePath)
    return {
      metaData,
      path: filename,
      contentType: videoFile.type,
      previewImage
    }
  }
}

import crypto from 'crypto'
import fs from 'fs/promises'
import mime from 'mime-types'
import path from 'path'
import process from 'process'
import sharp from 'sharp'

import { MediaStorageFileConfig } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { MAX_HEIGHT, MAX_WIDTH } from './constants'
import { extractVideoImage } from './extractVideoImage'
import { extractVideoMeta } from './extractVideoMeta'
import { getMediaAttachment } from './getMediaAttachment'
import { checkQuotaAvailable } from './quota'
import {
  MediaSchema,
  MediaStorage,
  MediaStorageGetFileOutput,
  ThumbnailStorageOutput
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
    const storageRoot = path.resolve(this._config.path)
    const fullPath = path.resolve(storageRoot, filePath)
    const relativePath = path.relative(storageRoot, fullPath)
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return null
    }

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

  async completePresignedUpload() {
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
      ...(media.description ? { description: media.description } : null),
      ...(media.focus ? { focus: media.focus } : null)
    })

    if (!storedMedia) {
      throw new Error('Fail to store media')
    }

    return getMediaAttachment(storedMedia, this._host)
  }

  async saveThumbnail(file: File): Promise<ThumbnailStorageOutput | null> {
    if (!file.type.startsWith('image')) return null

    // Use the stored WebP's actual size/dimensions (outputInfo), not the input
    // image's metadata.
    const { outputInfo, path } = await this._saveImageFile(file, true)
    return {
      path,
      bytes: outputInfo.size,
      mimeType: 'image/webp',
      metaData: {
        width: outputInfo.width,
        height: outputInfo.height
      }
    }
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
    // `metadata()` reports the INPUT image; `toFile()` resolves with the OUTPUT
    // info (post-resize/WebP dimensions and byte size). Callers that need the
    // stored file's real size/dimensions (e.g. thumbnails) use `outputInfo`.
    const [metaData, outputInfo] = await Promise.all([
      resizedImage.metadata(),
      resizedImage.keepExif().toFile(filePath)
    ])

    return {
      image: resizedImage,
      metaData,
      outputInfo,
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

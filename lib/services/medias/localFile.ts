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

import { MAX_HEIGHT, MAX_WIDTH, STORED_IMAGE_RESIZE_OPTIONS } from './constants'
import { MediaValidationError } from './errors'
import { extractVideoImage } from './extractVideoImage'
import { extractVideoMeta } from './extractVideoMeta'
import { getStoredMediaExtension, sanitizeStoredFileName } from './fileName'
import { getMediaAttachment } from './getMediaAttachment'
import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  type ImageOutputFormat,
  encodeImageOutput,
  getImageOutputFormatDetail
} from './imageOutputFormat'
import { getMediaFileUrl } from './mediaFileUrl'
import { checkQuotaAvailable } from './quota'
import {
  assertReadableImageBytes,
  assertReadableThumbnail,
  getUploadQuotaReservation
} from './thumbnailInput'
import {
  ImageRenditionOutput,
  MediaSchema,
  MediaStorage,
  MediaStorageGetFileOutput,
  ThumbnailStorageOutput
} from './types'

interface SaveImageOptions {
  isThumbnail?: boolean
  format?: ImageOutputFormat
}

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
    // Validate the thumbnail before anything is written, so unusable bytes
    // cannot leave a stored original behind.
    if (media.thumbnail) {
      await assertReadableThumbnail(media.thumbnail)
    }

    // Check quota before saving; the reservation covers the thumbnail, whose
    // stored bytes `createMedia` meters too.
    const quotaCheck = await checkQuotaAvailable(
      this._database,
      actor,
      getUploadQuotaReservation(media)
    )
    if (!quotaCheck.available) {
      throw new MediaValidationError(
        `Storage quota exceeded. Used: ${quotaCheck.used} bytes, Limit: ${quotaCheck.limit} bytes`
      )
    }

    const { path, metaData, previewImage } = file.type.startsWith('video')
      ? await this._saveVideoFile(file)
      : await this._saveImageFile(file)
    let thumbnail
    try {
      thumbnail = media.thumbnail
        ? await this._saveImageFile(media.thumbnail, { isThumbnail: true })
        : previewImage
          ? await this._saveImageBuffer(previewImage, { isThumbnail: true })
          : null
    } catch (error) {
      // The original is already written and no `medias` row will reference it,
      // so reclaim it before the failure propagates. The error passes through
      // untouched: the thumbnail's bytes were validated before any of this ran,
      // so whatever failed here is ours — a storage fault that has to stay a
      // logged 500, not be relabelled as the caller's bad input.
      await this.deleteFile(path).catch(() => false)
      throw error
    }
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
        fileName: sanitizeStoredFileName(file.name)
      },
      ...(thumbnail
        ? {
            // Use the resized image's actual size/dimensions (outputInfo), not
            // the input image's metadata.
            thumbnail: {
              path: thumbnail.path,
              bytes: thumbnail.outputInfo.size,
              mimeType: thumbnail.contentType,
              metaData: {
                width: thumbnail.outputInfo.width,
                height: thumbnail.outputInfo.height
              }
            }
          }
        : null),
      ...(media.description ? { description: media.description } : null),
      ...(media.focus ? { focus: media.focus } : null)
    })

    if (!storedMedia) {
      // Same reclaim as above — without a row, nothing can find these again.
      await this.deleteFile(path).catch(() => false)
      if (thumbnail) {
        await this.deleteFile(thumbnail.path).catch(() => false)
      }
      throw new Error('Fail to store media')
    }

    return getMediaAttachment(storedMedia, this._host)
  }

  async saveThumbnail(
    actor: Actor,
    file: File
  ): Promise<ThumbnailStorageOutput | null> {
    if (!file.type.startsWith('image')) return null
    // Same validation saveFile applies, so the dedicated thumbnail endpoint
    // answers unreadable bytes with the same 422 rather than a 500.
    await assertReadableImageBytes(file)

    // Enforce the account quota like saveFile, so a thumbnail replacement can't
    // push usage past the limit.
    const quotaCheck = await checkQuotaAvailable(
      this._database,
      actor,
      file.size
    )
    if (!quotaCheck.available) {
      throw new MediaValidationError(
        `Storage quota exceeded. Used: ${quotaCheck.used} bytes, Limit: ${quotaCheck.limit} bytes`
      )
    }

    // Use the stored image's actual size/dimensions (outputInfo), not the input
    // image's metadata.
    const { outputInfo, path, contentType } = await this._saveImageFile(file, {
      isThumbnail: true
    })
    return {
      path,
      bytes: outputInfo.size,
      mimeType: contentType,
      metaData: {
        width: outputInfo.width,
        height: outputInfo.height
      }
    }
  }

  async saveImageRendition(
    actor: Actor,
    file: File,
    format: ImageOutputFormat
  ): Promise<ImageRenditionOutput | null> {
    if (!file.type.startsWith('image')) return null

    // Refuse the write when the account is already over quota. Note the bytes
    // are not metered afterwards: usage is counter-based and those counters are
    // maintained alongside `medias` rows, which a rendition has none of. Keep
    // renditions few and small.
    const quotaCheck = await checkQuotaAvailable(
      this._database,
      actor,
      file.size
    )
    if (!quotaCheck.available) {
      throw new MediaValidationError(
        `Storage quota exceeded. Used: ${quotaCheck.used} bytes, Limit: ${quotaCheck.limit} bytes`
      )
    }

    const { outputInfo, path, contentType } = await this._saveImageFile(file, {
      format
    })
    return {
      path,
      url: getMediaFileUrl(this._host, path),
      bytes: outputInfo.size,
      mimeType: contentType,
      metaData: {
        width: outputInfo.width,
        height: outputInfo.height
      }
    }
  }

  private async _saveImageFile(
    imageFile: File,
    options: SaveImageOptions = {}
  ) {
    return this._saveImageBuffer(
      Buffer.from(await imageFile.arrayBuffer()),
      options
    )
  }

  // Images are re-encoded under a generated name, so the supplied file name
  // plays no part in the stored path — the parameter that used to carry it was
  // never read here.
  private async _saveImageBuffer(
    imageBuffer: Buffer,
    {
      isThumbnail = false,
      format = DEFAULT_IMAGE_OUTPUT_FORMAT
    }: SaveImageOptions = {}
  ) {
    const uploadPath = this._config.path
    const { extension, contentType } = getImageOutputFormatDetail(format)

    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const filename = `${randomPrefix}${isThumbnail ? '-thumbnail' : ''}.${extension}`
    const filePath = path.resolve(process.cwd(), uploadPath, filename)
    const resizedImage = encodeImageOutput(
      sharp(imageBuffer)
        .resize(MAX_WIDTH, MAX_HEIGHT, STORED_IMAGE_RESIZE_OPTIONS)
        .rotate(),
      format
    )
    // `metadata()` reports the INPUT image; `toFile()` resolves with the OUTPUT
    // info (post-resize/re-encode dimensions and byte size). Callers that need
    // the stored file's real size/dimensions (e.g. thumbnails) use `outputInfo`.
    // Read metadata from a separate sharp instance so the two operations don't
    // run concurrently on the same pipeline.
    const [metaData, outputInfo] = await Promise.all([
      sharp(imageBuffer).metadata(),
      resizedImage.keepExif().toFile(filePath)
    ])

    return {
      image: resizedImage,
      metaData,
      outputInfo,
      path: filename,
      contentType,
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
      throw new MediaValidationError('Invalid video format')
    }

    const metaData = videoStream
      ? { width: videoStream.width, height: videoStream.height }
      : { width: 0, height: 0 }

    const ext = getStoredMediaExtension(videoFile.type, videoFile.name)

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

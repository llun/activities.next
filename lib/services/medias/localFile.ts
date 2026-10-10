import crypto from 'crypto'
import fs from 'fs/promises'
import mime from 'mime-types'
import path from 'path'
import sharp from 'sharp'
import { Readable } from 'stream'

import { MediaStorageFileConfig } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import {
  ImageAnalysisResult,
  analyzeImageBuffer
} from '@/lib/services/medias/imageAnalysis'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { MediaValidationError } from './errors'
import { extractVideoMeta } from './extractVideoMeta'
import { getStoredMediaExtension } from './fileName'
import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  type ImageOutputFormat,
  encodeImageOutput,
  getImageOutputFormatDetail
} from './imageOutputFormat'
import { getMediaFileUrl } from './mediaFileUrl'
import { checkQuotaAvailable } from './quota'
import { saveMediaFile } from './saveMediaFile'
import { assertStorageFilePath, resolveStorageFilePath } from './storagePath'
import { createStoredImagePipeline } from './storedImagePipeline'
import { readValidThumbnail } from './thumbnailInput'
import {
  EditedImageStorageOutput,
  ImageRenditionOutput,
  MediaSchema,
  MediaStorage,
  MediaStorageGetFileOutput,
  SaveEditedImageParams,
  SaveFileOptions,
  ThumbnailStorageOutput
} from './types'
import { extractVideoPreviewFrame } from './videoPreview'
import { getAcceptedVideoDimensions } from './videoProbe'

interface SaveImageOptions {
  isThumbnail?: boolean
  format?: ImageOutputFormat
  manualFocus?: { x: number; y: number } | null
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
    const fullPath = resolveStorageFilePath(this._config.path, filePath)
    if (!fullPath) return null

    const contentType = mime.contentType(path.extname(fullPath))
    if (!contentType) return null

    try {
      // Streamed, not read whole: the files route serving this is
      // unauthenticated, so a buffered read let any client pin a full object
      // in memory per request. Opening first keeps a missing file a null.
      const handle = await fs.open(fullPath, 'r')
      try {
        const { size } = await handle.stat()
        return MediaStorageGetFileOutput.parse({
          type: 'stream',
          stream: Readable.toWeb(handle.createReadStream()),
          contentType,
          contentLength: size
        })
      } catch (error) {
        await handle.close().catch(() => undefined)
        throw error
      }
    } catch (e) {
      const error = e as NodeJS.ErrnoException
      logger.error(error)
      return null
    }
  }

  async deleteFile(filePath: string): Promise<boolean> {
    // Same containment rule `getFile` applies. An unlink is the more damaging
    // half of the pair, so the check cannot live on the read path alone.
    const fullPath = resolveStorageFilePath(this._config.path, filePath)
    if (!fullPath) return false

    try {
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

  async saveFile(actor: Actor, media: MediaSchema, options?: SaveFileOptions) {
    return saveMediaFile({
      database: this._database,
      host: this._host,
      actor,
      media,
      withGalleryDetails: options?.withGalleryDetails,
      driver: {
        saveVideoFile: (file, options) => this._saveVideoFile(file, options),
        saveImageFile: (file, options) => this._saveImageFile(file, options),
        saveThumbnailBuffer: (buffer) =>
          this._saveImageBuffer(buffer, { isThumbnail: true }),
        deleteFile: (filePath) => this.deleteFile(filePath)
      }
    })
  }

  async saveThumbnail(
    actor: Actor,
    file: File
  ): Promise<ThumbnailStorageOutput | null> {
    if (!file.type.startsWith('image')) return null
    // Same validation saveFile applies, so the dedicated thumbnail endpoint
    // answers unusable bytes with the same 422 rather than a 500.
    const buffer = await readValidThumbnail(file)

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
    const { outputInfo, path, contentType, blurhash } =
      await this._saveImageBuffer(buffer, { isThumbnail: true })
    return {
      path,
      bytes: outputInfo.size,
      mimeType: contentType,
      metaData: {
        width: outputInfo.width,
        height: outputInfo.height
      },
      blurhash
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

  async saveEditedImage({
    buffer,
    manualFocus
  }: SaveEditedImageParams): Promise<EditedImageStorageOutput> {
    // The same pipeline and encoder as every stored image: orientation
    // applied, fitted inside the stored-image box, WebP with no EXIF, under a
    // random name inside the storage root.
    const { outputInfo, path, contentType, blurhash, focus } =
      await this._saveImageBuffer(buffer, { manualFocus })
    return {
      path,
      bytes: outputInfo.size,
      mimeType: contentType,
      width: outputInfo.width,
      height: outputInfo.height,
      blurhash,
      focus
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
      format = DEFAULT_IMAGE_OUTPUT_FORMAT,
      manualFocus
    }: SaveImageOptions = {}
  ) {
    const uploadPath = this._config.path
    const { extension, contentType } = getImageOutputFormatDetail(format)

    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const filename = `${randomPrefix}${isThumbnail ? '-thumbnail' : ''}.${extension}`
    const filePath = assertStorageFilePath(uploadPath, filename)
    const resizedImage = encodeImageOutput(
      createStoredImagePipeline(imageBuffer),
      format
    )
    // `metadata()` reports the INPUT image; `toFile()` resolves with the OUTPUT
    // info (post-resize/re-encode dimensions and byte size). Callers that need
    // the stored file's real size/dimensions (e.g. thumbnails) use `outputInfo`.
    // Read metadata from a separate sharp instance so the two operations don't
    // run concurrently on the same pipeline.
    const [metaData, outputInfo, analysis] = await Promise.all([
      sharp(imageBuffer).metadata(),
      // No `keepExif()`: EXIF carries GPS position and device identifiers, and
      // the stored file is public. Orientation is already applied by the
      // pipeline's `.rotate()`.
      resizedImage.toFile(filePath),
      analyzeImageBuffer(imageBuffer, { manualFocus })
    ])

    return {
      image: resizedImage,
      metaData,
      outputInfo,
      path: filename,
      contentType,
      previewImage: null,
      blurhash: analysis.blurhash,
      focus: analysis.focus
    }
  }

  // Mirrors `S3FileStorage._uploadVideoToS3`: probe, validate, extract the
  // preview frame from a temp copy, and only then store. Writing the video into
  // the media root first and extracting from it afterwards left the bytes on
  // disk whenever ffmpeg found no decodable frame, with no `medias` row — the
  // only handle anything but `scripts/maintenance/cleanupMediaStorage.ts` has
  // on a stored path.
  private async _saveVideoFile(
    videoFile: File,
    options: { manualFocus?: { x: number; y: number } | null } = {}
  ) {
    const uploadPath = this._config.path
    const buffer = Buffer.from(await videoFile.arrayBuffer())
    const probe = await extractVideoMeta(buffer)
    // Container, video stream and dimension cap — shared with the other
    // driver and the presigned completion.
    const metaData = getAcceptedVideoDimensions(probe)

    const ext = getStoredMediaExtension(videoFile.type, videoFile.name)
    // Input that is not a video the instance accepts was already rejected
    // above, without spawning ffmpeg. What can still fail here is the frame
    // itself, and it fails before the media root is touched.
    const previewImage = await extractVideoPreviewFrame(buffer, ext)

    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const filename = `${randomPrefix}${ext}`
    const filePath = assertStorageFilePath(uploadPath, filename)
    await fs.writeFile(filePath, buffer)

    let analysis: ImageAnalysisResult = {
      blurhash: null,
      focus: options.manualFocus ?? null
    }
    if (previewImage) {
      analysis = await analyzeImageBuffer(previewImage, {
        manualFocus: options.manualFocus
      })
    }

    return {
      metaData,
      path: filename,
      contentType: videoFile.type,
      previewImage,
      blurhash: analysis.blurhash,
      focus: analysis.focus
    }
  }
}

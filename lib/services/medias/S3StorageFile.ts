import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'crypto'
import { format } from 'date-fns'
import fs from 'fs/promises'
import { IncomingMessage } from 'http'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import sharp from 'sharp'

import { MediaStorageS3Config } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import {
  MAX_FILE_SIZE,
  MAX_HEIGHT,
  MAX_WIDTH
} from '@/lib/services/medias/constants'
import { extractVideoImage } from '@/lib/services/medias/extractVideoImage'
import { extractVideoMeta } from '@/lib/services/medias/extractVideoMeta'
import { checkQuotaAvailable } from '@/lib/services/medias/quota'
import {
  MediaSchema,
  MediaStorage,
  MediaStorageGetFileOutput,
  MediaStorageGetRedirectOutput,
  MediaStorageSaveFileOutput,
  MediaType,
  PresigedMediaInput,
  PresignedUrlOutput
} from '@/lib/services/medias/types'
import { Media } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import {
  assertByteLengthWithinLimit,
  readUnknownBodyToBufferWithLimit
} from '@/lib/utils/streamLimit'

const normalizeContentType = (contentType?: string | string[]) => {
  const value = Array.isArray(contentType) ? contentType[0] : contentType
  return value?.split(';')[0]?.trim().toLowerCase() ?? ''
}

const sha1HexToBase64 = (checksum: string) =>
  Buffer.from(checksum, 'hex').toString('base64')

export class PresignedUploadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresignedUploadValidationError'
  }
}

const isS3NotFoundError = (error: unknown) => {
  const nodeError = error as {
    name?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    nodeError.name === 'NoSuchKey' ||
    nodeError.name === 'NotFound' ||
    nodeError.$metadata?.httpStatusCode === 404
  )
}

const getObjectMetadataChecksumSha1 = (
  metadata: Record<string, string> | undefined
) =>
  metadata?.checksumsha1 ??
  metadata?.checksumSha1 ??
  metadata?.['checksum-sha1'] ??
  null

const PRESIGNED_UPLOAD_UNHOISTABLE_HEADERS = new Set([
  'x-amz-checksum-sha1',
  'x-amz-meta-checksumsha1'
])

export class S3FileStorage implements MediaStorage {
  private static _instance: MediaStorage

  private _config: MediaStorageS3Config
  private _host: string
  private _database: Database

  private _client: S3Client

  static getStorage(
    config: MediaStorageS3Config,
    host: string,
    database: Database
  ) {
    if (!S3FileStorage._instance) {
      S3FileStorage._instance = new S3FileStorage(config, host, database)
    }
    return S3FileStorage._instance
  }

  constructor(config: MediaStorageS3Config, host: string, database: Database) {
    this._config = config
    this._host = host
    this._database = database
    this._client = new S3Client({ region: config.region })
  }

  async getFile(filePath: string) {
    const { bucket, hostname } = this._config
    if (hostname) {
      return MediaStorageGetRedirectOutput.parse({
        type: 'redirect',
        redirectUrl: `https://${hostname}/${filePath}`
      })
    }

    const s3client = this._client
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: filePath
    })
    const object = await s3client.send(command)
    if (!object.Body) return null

    const message = object.Body
    const maxBytes = this._config.maxFileSize ?? MAX_FILE_SIZE
    assertByteLengthWithinLimit({
      byteLength: object.ContentLength,
      maxBytes,
      label: 'Media object body'
    })
    return MediaStorageGetFileOutput.parse({
      type: 'buffer',
      contentType:
        object.ContentType ??
        (message as IncomingMessage).headers?.['content-type'] ??
        'application/octet-stream',
      buffer: await readUnknownBodyToBufferWithLimit(
        message,
        maxBytes,
        'Media object body'
      )
    })
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      const { bucket } = this._config
      const s3client = this._client
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: filePath
      })
      await s3client.send(command)
      return true
    } catch (e) {
      const error = e as Error
      // If file doesn't exist (NoSuchKey), consider it already deleted (success)
      if (error.name === 'NoSuchKey') {
        return true
      }
      logger.error({
        message: 'Failed to delete file from S3',
        filePath,
        error: error.message
      })
      return false
    }
  }

  isPresigedSupported() {
    return true
  }

  async getPresigedForSaveFileUrl(
    actor: Actor,
    presignedMedia: PresigedMediaInput
  ) {
    // Check quota before generating presigned URL
    const quotaCheck = await checkQuotaAvailable(
      this._database,
      actor,
      presignedMedia.size
    )
    if (!quotaCheck.available) {
      throw new Error(
        `Storage quota exceeded. Used: ${quotaCheck.used} bytes, Limit: ${quotaCheck.limit} bytes`
      )
    }

    const { bucket } = this._config
    const { fileName } = presignedMedia

    const currentTime = Date.now()
    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const timeDirectory = format(currentTime, 'yyyy-MM-dd')

    const ext = fileName.endsWith('.mov') ? '.mp4' : extname(fileName)
    const mimeType =
      presignedMedia.contentType === 'video/quicktime'
        ? 'video/mp4'
        : presignedMedia.contentType
    const checksumSha1Base64 = sha1HexToBase64(presignedMedia.checksum)

    const key = `medias/${timeDirectory}/${randomPrefix}${ext}`
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: presignedMedia.contentType,
      ContentLength: presignedMedia.size,
      ChecksumSHA1: checksumSha1Base64,
      Metadata: {
        checksumSha1: presignedMedia.checksum
      }
    })
    const url = await getSignedUrl(this._client, command, {
      expiresIn: 600,
      unhoistableHeaders: PRESIGNED_UPLOAD_UNHOISTABLE_HEADERS
    })
    const storedMedia = await this._database.createMedia({
      actorId: actor.id,
      original: {
        path: key,
        bytes: presignedMedia.size,
        mimeType,
        metaData: {
          width: presignedMedia.width ?? 0,
          height: presignedMedia.height ?? 0,
          upload: {
            state: 'pending',
            checksumSha1: presignedMedia.checksum,
            checksumSha1Base64,
            contentType: presignedMedia.contentType,
            size: presignedMedia.size
          }
        },
        fileName
      }
    })
    if (!storedMedia) {
      return null
    }
    return PresignedUrlOutput.parse({
      url,
      saveFileOutput: {
        id: `${storedMedia.id}`,
        type: presignedMedia.contentType.startsWith('video')
          ? MediaType.enum.video
          : MediaType.enum.image,
        mime_type: mimeType,
        url: `https://${this._host}/api/v1/files/${key}`,
        preview_url: null,
        text_url: null,
        remote_url: null,
        meta: {
          original: {
            width: presignedMedia.width ?? 0,
            height: presignedMedia.height ?? 0,
            size: `${presignedMedia.width}x${presignedMedia.height}`,
            aspect: presignedMedia.width / presignedMedia.height
          }
        },
        description: ''
      },
      headers: {
        'x-amz-checksum-sha1': checksumSha1Base64,
        'x-amz-meta-checksumsha1': presignedMedia.checksum
      }
    })
  }

  async completePresignedUpload(actor: Actor, mediaId: string) {
    const accountId = actor.account?.id
    if (!accountId) {
      throw new Error('Actor account is required to complete media upload')
    }

    const media = await this._database.getMediaByIdForAccount({
      mediaId,
      accountId
    })
    if (!media) {
      return null
    }

    const upload = media.original.metaData.upload
    if (upload?.state === 'verified') {
      return this._getSaveFileOutput(media)
    }
    if (!upload || upload.state !== 'pending') {
      throw new Error('Media upload is not pending verification')
    }

    try {
      const object = await this._client
        .send(
          new HeadObjectCommand({
            Bucket: this._config.bucket,
            Key: media.original.path
          })
        )
        .catch((error) => {
          if (isS3NotFoundError(error)) {
            throw new PresignedUploadValidationError(
              'Uploaded object is missing'
            )
          }
          throw error
        })
      const expectedSize = upload.size ?? media.original.bytes
      const expectedContentType = normalizeContentType(
        upload.contentType ?? media.original.mimeType
      )
      const actualContentType = normalizeContentType(object.ContentType)

      if (object.ContentLength !== expectedSize) {
        throw new PresignedUploadValidationError(
          'Uploaded object does not match expected size'
        )
      }
      if (actualContentType !== expectedContentType) {
        throw new PresignedUploadValidationError(
          'Uploaded object does not match expected content type'
        )
      }
      const metadataChecksumSha1 = getObjectMetadataChecksumSha1(
        object.Metadata
      )
      if (
        object.ChecksumSHA1 &&
        upload.checksumSha1Base64 &&
        object.ChecksumSHA1 !== upload.checksumSha1Base64
      ) {
        throw new PresignedUploadValidationError(
          'Uploaded object does not match expected checksum'
        )
      }
      if (
        !object.ChecksumSHA1 &&
        upload.checksumSha1 &&
        metadataChecksumSha1 !== upload.checksumSha1
      ) {
        throw new PresignedUploadValidationError(
          metadataChecksumSha1
            ? 'Uploaded object does not match expected checksum'
            : 'Uploaded object does not include expected checksum'
        )
      }

      const verifiedMedia = await this._database.markMediaUploadVerified({
        mediaId,
        accountId,
        verifiedAt: Date.now()
      })
      if (!verifiedMedia) {
        return null
      }
      return this._getSaveFileOutput(verifiedMedia)
    } catch (error) {
      if (error instanceof PresignedUploadValidationError) {
        await this.deleteFile(media.original.path).catch(() => false)
        await this._database.deleteMedia({ mediaId }).catch(() => false)
      }
      throw error
    }
  }

  async saveFile(actor: Actor, media: MediaSchema) {
    const { file } = media
    const currentTime = Date.now()
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

    if (file.type.startsWith('video')) {
      const { path, metaData, contentType, previewImage } =
        await this._uploadVideoToS3(currentTime, file)
      const thumbnail = await this._uploadImageBufferToS3(
        currentTime,
        previewImage,
        true
      )
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
        thumbnail: {
          path: thumbnail.path,
          bytes: thumbnail.metaData.size ?? 0,
          mimeType: `image/${thumbnail.metaData.format ?? 'jpg'}`,
          metaData: {
            width: thumbnail.metaData.width ?? 0,
            height: thumbnail.metaData.height ?? 0
          }
        },
        ...(media.description ? { description: media.description } : null)
      })
      if (!storedMedia) {
        throw new Error('Fail to store media')
      }
      return this._getSaveFileOutput(storedMedia, contentType)
    }

    const { metaData, path } = await this._uploadImageToS3(currentTime, file)
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
      ...(media.description ? { description: media.description } : null)
    })
    if (!storedMedia) {
      throw new Error('Fail to store media')
    }
    return this._getSaveFileOutput(storedMedia)
  }

  private async _uploadImageToS3(
    currentTime: number,
    file: File,
    isThumbnail = false
  ) {
    return this._uploadImageBufferToS3(
      currentTime,
      Buffer.from(await file.arrayBuffer()),
      isThumbnail
    )
  }

  private async _uploadImageBufferToS3(
    currentTime: number,
    buffer: Buffer,
    isThumbnail = false
  ) {
    const { bucket } = this._config
    const randomPrefix = crypto.randomBytes(8).toString('hex')

    const resizedImage = sharp(buffer)
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
    const path = `medias/${timeDirectory}/${randomPrefix}${isThumbnail ? '-thumbnail' : ''}.webp`
    const s3client = this._client

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
    await fs.unlink(tempFilePath)
    return { image: resizedImage, metaData, path, contentType }
  }

  private async _uploadVideoToS3(currentTime: number, file: File) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const tmpVideoFile = join(
      tmpdir(),
      `${crypto.randomBytes(8).toString('hex')}${file.name}`
    )
    await fs.writeFile(tmpVideoFile, buffer)
    const [probe, previewImage] = await Promise.all([
      extractVideoMeta(buffer),
      extractVideoImage(tmpVideoFile)
    ])
    await fs.unlink(tmpVideoFile)
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

    const { bucket } = this._config
    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const timeDirectory = format(currentTime, 'yyyy-MM-dd')
    const ext = file.name.endsWith('.mov') ? '.mp4' : extname(file.name)
    const path = `medias/${timeDirectory}/${randomPrefix}${ext}`
    const s3client = this._client
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      ContentType: file.type,
      Body: buffer
    })
    await s3client.send(command)
    return { path, metaData, contentType: file.type, previewImage }
  }

  private _getSaveFileOutput(
    media: Media,
    contentType?: string
  ): MediaStorageSaveFileOutput {
    const mimeType = contentType ?? media.original.mimeType
    const type = mimeType.startsWith('video')
      ? MediaType.enum.video
      : MediaType.enum.image
    const url = `https://${this._host}/api/v1/files/${media.original.path}`
    const previewUrl = media.thumbnail
      ? `https://${this._host}/api/v1/files/${media.thumbnail?.path}`
      : url
    return MediaStorageSaveFileOutput.parse({
      id: `${media.id}`,
      type,
      mime_type: mimeType,
      // TODO: Add config for base image domain?
      url,
      preview_url: previewUrl,
      text_url: null,
      remote_url: null,
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
                  media.thumbnail.metaData.width /
                  media.thumbnail.metaData.height
              }
            }
          : null)
      },
      description: media?.description ?? ''
    })
  }
}

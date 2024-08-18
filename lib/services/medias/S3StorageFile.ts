import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import crypto from 'crypto'
import { format } from 'date-fns'
import fs from 'fs/promises'
import { IncomingMessage } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'

import { Actor } from '@/lib/models/actor'
import { Storage } from '@/lib/storage/types'

import { MediaStorageS3Config } from '../../config/mediaStorage'
import { Media } from '../../storage/types/media'
import { MAX_HEIGHT, MAX_WIDTH } from './constants'
import { extractVideoImage } from './extractVideoImage'
import { extractVideoMeta } from './extractVideoMeta'
import {
  MediaSchema,
  MediaStorage,
  MediaStorageGetFileOutput,
  MediaStorageGetRedirectOutput,
  MediaStorageSaveFileOutput,
  MediaType,
  PresigedMediaInput,
  PresignedUrlOutput
} from './types'

export class S3FileStorage implements MediaStorage {
  private static _instance: MediaStorage

  private _config: MediaStorageS3Config
  private _host: string
  private _storage: Storage

  private _client: S3Client

  static getStorage(
    config: MediaStorageS3Config,
    host: string,
    storage: Storage
  ) {
    if (!S3FileStorage._instance) {
      S3FileStorage._instance = new S3FileStorage(config, host, storage)
    }
    return S3FileStorage._instance
  }

  constructor(config: MediaStorageS3Config, host: string, storage: Storage) {
    this._config = config
    this._host = host
    this._storage = storage
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
    return MediaStorageGetFileOutput.parse({
      type: 'buffer',
      contentType: (message as IncomingMessage).headers['content-type'],
      buffer: Buffer.from(await message.transformToByteArray())
    })
  }

  isPresigedSupported() {
    return true
  }

  async getPresigedForSaveFileUrl(
    actor: Actor,
    presignedMedia: PresigedMediaInput
  ) {
    const { bucket } = this._config
    const { fileName } = presignedMedia

    const currentTime = Date.now()
    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const timeDirectory = format(currentTime, 'yyyy-MM-dd')

    const finalFileName = fileName.endsWith('.mov')
      ? `${fileName.split('.')[0]}.mp4`
      : fileName

    const key = `medias/${timeDirectory}/${randomPrefix}-${finalFileName}`
    const { url, fields } = await createPresignedPost(this._client, {
      Bucket: bucket,
      Key: key,
      Conditions: [
        { bucket },
        { key },
        ['eq', '$Content-Type', presignedMedia.contentType],
        ['content-length-range', 0, presignedMedia.size]
      ],
      Expires: 600
    })
    const storedMedia = await this._storage.createMedia({
      actorId: actor.id,
      original: {
        path: key,
        bytes: presignedMedia.size,
        mimeType: presignedMedia.contentType,
        metaData: {
          width: presignedMedia.width ?? 0,
          height: presignedMedia.height ?? 0
        }
      }
    })
    if (!storedMedia) {
      return null
    }

    return PresignedUrlOutput.parse({
      url,
      fields,
      saveFileOutput: {
        id: storedMedia.id,
        type: presignedMedia.contentType.startsWith('video')
          ? MediaType.enum.video
          : MediaType.enum.image,
        mime_type: presignedMedia.contentType,
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
      }
    })
  }

  async saveFile(actor: Actor, media: MediaSchema) {
    const { file } = media
    const currentTime = Date.now()
    if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
      return null
    }

    if (file.type.startsWith('video')) {
      const { path, metaData, contentType, previewImage } =
        await this._uploadVideoToS3(currentTime, file)
      const thumbnail = await this._uploadImageBufferToS3(
        currentTime,
        previewImage,
        true
      )
      const storedMedia = await this._storage.createMedia({
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
    const storedMedia = await this._storage.createMedia({
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
    const fileName = file.name.endsWith('.mov')
      ? `${file.name.split('.')[0]}.mp4`
      : file.name
    const path = `medias/${timeDirectory}/${randomPrefix}-${fileName}`
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
      id: media.id,
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

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import crypto from 'crypto'
import { format } from 'date-fns'
import { Readable } from 'stream'
import type { ReadableStream as WebReadableStream } from 'stream/web'

import { FitnessStorageS3Config } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { QuotaExceededError } from './errors'
import { checkFitnessQuotaAvailable } from './quota'
import {
  FitnessFileUploadSchema,
  FitnessStorage,
  FitnessStorageGetFileOutput,
  FitnessStorageSaveFileOutput,
  PresignedFitnessUrlOutput,
  getFitnessFileType
} from './types'

export class S3FitnessStorage implements FitnessStorage {
  private static _instance: FitnessStorage
  private _config: FitnessStorageS3Config
  private _host: string
  private _database: Database
  private _client: S3Client

  static getStorage(
    config: FitnessStorageS3Config,
    host: string,
    database: Database
  ) {
    if (!S3FitnessStorage._instance) {
      S3FitnessStorage._instance = new S3FitnessStorage(config, host, database)
    }
    return S3FitnessStorage._instance
  }

  constructor(
    config: FitnessStorageS3Config,
    host: string,
    database: Database
  ) {
    this._config = config
    this._host = host
    this._database = database
    this._client = new S3Client({ region: config.region })
  }

  async getFile(filePath: string) {
    const { bucket, prefix } = this._config
    const fullPath = prefix ? `${prefix}${filePath}` : filePath

    try {
      const s3client = this._client
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: fullPath
      })
      const object = await s3client.send(command)
      if (!object.Body) return null

      const message = object.Body
      return FitnessStorageGetFileOutput.parse({
        type: 'buffer',
        contentType: object.ContentType ?? 'application/octet-stream',
        buffer: Buffer.from(await message.transformToByteArray())
      })
    } catch (error) {
      const nodeError = error as {
        name?: string
        $metadata?: { httpStatusCode?: number }
      }
      if (
        nodeError.name === 'NoSuchKey' ||
        nodeError.name === 'NotFound' ||
        nodeError.$metadata?.httpStatusCode === 404
      ) {
        return null
      }
      throw error
    }
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      const { bucket, prefix } = this._config
      const fullPath = prefix ? `${prefix}${filePath}` : filePath
      const s3client = this._client
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: fullPath
      })
      await s3client.send(command)
      return true
    } catch (e) {
      const error = e as Error
      if (error.name === 'NoSuchKey') {
        return true
      }
      logger.error({
        message: 'Failed to delete fitness file from S3',
        filePath,
        error: error.message
      })
      return false
    }
  }

  async saveFile(actor: Actor, fitnessFile: FitnessFileUploadSchema) {
    const { file, description, importBatchId } = fitnessFile

    // Check quota before saving
    const quotaCheck = await checkFitnessQuotaAvailable(
      this._database,
      actor,
      file.size
    )
    if (!quotaCheck.available) {
      throw new QuotaExceededError(
        'Storage quota exceeded',
        quotaCheck.used,
        quotaCheck.limit
      )
    }

    const { bucket, prefix } = this._config
    const fileType = getFitnessFileType(file.name, file.type)
    const ext = `.${fileType}`

    const currentTime = Date.now()
    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const timeDirectory = format(currentTime, 'yyyy-MM-dd')
    const fileName = `${timeDirectory}/${randomPrefix}${ext}`
    const key = prefix ? `${prefix}${fileName}` : fileName

    // Upload to S3 using a stream to avoid buffering large files in memory.
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Readable.fromWeb(file.stream() as WebReadableStream),
      ContentType: file.type
    })

    await this._client.send(command)

    // Create database record
    const storedFile = await this._database.createFitnessFile({
      actorId: actor.id,
      path: fileName, // Store relative path without prefix
      fileName: file.name,
      fileType,
      mimeType: file.type,
      bytes: file.size,
      description,
      importBatchId
    })

    if (!storedFile) {
      throw new Error('Failed to store fitness file')
    }

    const protocol =
      this._host.startsWith('localhost') ||
      this._host.startsWith('127.0.0.1') ||
      this._host.startsWith('::1') ||
      this._host.startsWith('[::1]')
        ? 'http'
        : 'https'
    const url = `${protocol}://${this._host}/api/v1/fitness-files/${storedFile.id}`

    return FitnessStorageSaveFileOutput.parse({
      id: storedFile.id,
      type: 'fitness',
      file_type: fileType,
      mime_type: file.type,
      url,
      fileName: file.name,
      size: file.size,
      description,
      hasMapData: false
    })
  }

  async getPresignedForSaveFileUrl(
    actor: Actor,
    input: {
      fileName: string
      contentType: string
      size: number
      importBatchId?: string
      description?: string
    }
  ): Promise<PresignedFitnessUrlOutput | null> {
    const quotaCheck = await checkFitnessQuotaAvailable(
      this._database,
      actor,
      input.size
    )
    if (!quotaCheck.available) {
      throw new QuotaExceededError(
        'Storage quota exceeded',
        quotaCheck.used,
        quotaCheck.limit
      )
    }

    const { bucket, prefix } = this._config
    const currentTime = Date.now()
    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const timeDirectory = format(currentTime, 'yyyy-MM-dd')
    const fileName = `${timeDirectory}/${randomPrefix}.zip`
    const key = prefix ? `${prefix}${fileName}` : fileName

    const { url, fields } = await createPresignedPost(this._client, {
      Bucket: bucket,
      Key: key,
      Conditions: [
        { bucket },
        { key },
        ['content-length-range', 0, input.size]
      ],
      Expires: 3600
    })

    const storedFile = await this._database.createFitnessFile({
      actorId: actor.id,
      path: fileName,
      fileName: input.fileName,
      fileType: 'zip',
      mimeType: input.contentType,
      bytes: input.size,
      description: input.description,
      importBatchId: input.importBatchId
    })

    if (!storedFile) {
      throw new Error(
        'Failed to pre-create fitness file record for presigned upload'
      )
    }

    return {
      url,
      fields,
      fitnessFileId: storedFile.id
    }
  }
}

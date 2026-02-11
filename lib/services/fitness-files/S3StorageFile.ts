import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import crypto from 'crypto'
import { format } from 'date-fns'
import { IncomingMessage } from 'http'

import { FitnessStorageS3Config } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { checkFitnessQuotaAvailable } from './quota'
import { QuotaExceededError } from './errors'
import {
  FitnessFileUploadSchema,
  FitnessStorage,
  FitnessStorageGetFileOutput,
  FitnessStorageGetRedirectOutput,
  FitnessStorageSaveFileOutput,
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
    const { bucket, hostname, prefix } = this._config
    const fullPath = prefix ? `${prefix}${filePath}` : filePath

    if (hostname) {
      return FitnessStorageGetRedirectOutput.parse({
        type: 'redirect',
        redirectUrl: `https://${hostname}/${fullPath}`
      })
    }

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
      contentType: (message as IncomingMessage).headers['content-type'],
      buffer: Buffer.from(await message.transformToByteArray())
    })
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
    const { file, description } = fitnessFile

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

    // Upload to S3
    const buffer = Buffer.from(await file.arrayBuffer())
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
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
      description
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
}

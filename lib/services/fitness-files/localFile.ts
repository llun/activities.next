import crypto from 'crypto'
import { format } from 'date-fns'
import { createWriteStream } from 'fs'
import fs from 'fs/promises'
import mime from 'mime-types'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'

import { FitnessStorageFileConfig } from '@/lib/config/fitnessStorage'
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
  getFitnessFileType
} from './types'

// Fallback MIME types for fitness file extensions not recognised by mime-types.
const FITNESS_MIME_TYPES: Record<string, string> = {
  '.fit': 'application/vnd.ant.fit',
  '.gpx': 'application/gpx+xml',
  '.tcx': 'application/vnd.garmin.tcx+xml',
  '.zip': 'application/zip'
}

export class LocalFileFitnessStorage implements FitnessStorage {
  private static _instance: FitnessStorage
  private _config: FitnessStorageFileConfig
  private _host: string
  private _database: Database

  static getStorage(
    config: FitnessStorageFileConfig,
    host: string,
    database: Database
  ) {
    if (!LocalFileFitnessStorage._instance) {
      LocalFileFitnessStorage._instance = new LocalFileFitnessStorage(
        config,
        host,
        database
      )
    }
    return LocalFileFitnessStorage._instance
  }

  constructor(
    config: FitnessStorageFileConfig,
    host: string,
    database: Database
  ) {
    this._config = config
    this._host = host
    this._database = database
  }

  async getFile(filePath: string) {
    const fullPath = path.resolve(this._config.path, filePath)
    const ext = path.extname(fullPath).toLowerCase()
    const contentType =
      mime.contentType(ext) ||
      FITNESS_MIME_TYPES[ext] ||
      'application/octet-stream'

    try {
      return FitnessStorageGetFileOutput.parse({
        type: 'buffer',
        buffer: await fs.readFile(fullPath),
        contentType
      })
    } catch (e) {
      const error = e as NodeJS.ErrnoException
      logger.error({
        message: 'Failed to read fitness file',
        filePath,
        error: error.message
      })
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
      if (error.code === 'ENOENT') {
        return true
      }
      logger.error({
        message: 'Failed to delete fitness file from local storage',
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

    // Generate file path
    const fileType = getFitnessFileType(file.name, file.type)
    const ext = `.${fileType}`
    const currentTime = Date.now()
    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const timeDirectory = format(currentTime, 'yyyy-MM-dd')
    const fileName = `${timeDirectory}/${randomPrefix}${ext}`
    const filePath = path.resolve(this._config.path, fileName)
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    // Save file using a stream to avoid buffering large files in memory.
    await pipeline(
      Readable.fromWeb(file.stream() as WebReadableStream),
      createWriteStream(filePath)
    )

    // Create database record
    const storedFile = await this._database.createFitnessFile({
      actorId: actor.id,
      path: fileName,
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
}

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
import { sanitizeStoredFileName } from '@/lib/services/medias/fileName'
import { checkQuotaAvailable } from '@/lib/services/medias/quota'
import {
  assertStorageFilePath,
  resolveStorageFilePath
} from '@/lib/services/medias/storagePath'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import { QuotaExceededError } from './errors'
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
    const fullPath = resolveStorageFilePath(this._config.path, filePath)
    if (!fullPath) {
      return null
    }

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
      const fullPath = resolveStorageFilePath(this._config.path, filePath)
      if (!fullPath) {
        return false
      }

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
    const { file, description, importBatchId, sourceUrl } = fitnessFile

    // Check quota before saving
    const quotaCheck = await checkQuotaAvailable(
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
    // Detect the type from the raw name: `sanitizeStoredFileName` caps the name
    // at 200 bytes, which can truncate a very long name past its extension, and
    // `getFitnessFileType` throws when neither the name nor the MIME type
    // identifies a type. The detected type is one of four literals and is the
    // only part of the name that reaches the storage path.
    const fileType = getFitnessFileType(file.name, file.type)
    const ext = `.${fileType}`
    // The supplied name itself is only persisted and rendered back to the user,
    // so it is reduced to an inert, bounded segment first. `fitness_files.fileName`
    // is `varchar(255) not null`, which an unbounded name fails to insert into.
    const storedFileName = sanitizeStoredFileName(file.name)
    const currentTime = Date.now()
    const randomPrefix = crypto.randomBytes(8).toString('hex')
    const timeDirectory = format(currentTime, 'yyyy-MM-dd')
    const fileName = `${timeDirectory}/${randomPrefix}${ext}`
    const filePath = assertStorageFilePath(this._config.path, fileName)
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
      fileName: storedFileName,
      fileType,
      mimeType: file.type,
      bytes: file.size,
      description,
      importBatchId,
      sourceUrl
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
      fileName: storedFileName,
      size: file.size,
      description,
      hasMapData: false
    })
  }

  async getPresignedForSaveFileUrl(
    _actor: Actor,
    _input: {
      fileName: string
      contentType: string
      size: number
      importBatchId?: string
      description?: string
    }
  ): Promise<import('./types').PresignedFitnessUrlOutput | null> {
    return null
  }

  async verifyPresignedUpload(): Promise<boolean> {
    return false
  }
}

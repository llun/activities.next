import { getConfig } from '@/lib/config'
import {
  FitnessStorageConfig,
  FitnessStorageS3Config,
  FitnessStorageType
} from '@/lib/config/fitnessStorage'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { Actor } from '@/lib/types/domain/actor'

import { S3FitnessStorage } from './S3StorageFile'
import { LocalFileFitnessStorage } from './localFile'
import { FitnessFileUploadSchema } from './types'

// Returns the effective fitness storage config. When fitness storage is not
// explicitly configured, falls back to media object storage with a 'fitness/'
// prefix (mirrors the getFitnessStorageConfig env-var fallback).
export const getEffectiveFitnessStorageConfig =
  (): FitnessStorageConfig | null => {
    const { fitnessStorage, mediaStorage } = getConfig()
    if (fitnessStorage) return fitnessStorage

    if (
      mediaStorage?.type === MediaStorageType.S3Storage ||
      mediaStorage?.type === MediaStorageType.ObjectStorage
    ) {
      return {
        type: mediaStorage.type as unknown as FitnessStorageS3Config['type'],
        bucket: mediaStorage.bucket,
        region: mediaStorage.region,
        hostname: mediaStorage.hostname,
        prefix: 'fitness/'
      }
    }

    return null
  }

export const saveFitnessFile = async (
  database: Database,
  actor: Actor,
  fitnessFile: FitnessFileUploadSchema
) => {
  const { host } = getConfig()
  const fitnessStorage = getEffectiveFitnessStorageConfig()
  switch (fitnessStorage?.type) {
    case FitnessStorageType.LocalFile: {
      return LocalFileFitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).saveFile(actor, fitnessFile)
    }
    case FitnessStorageType.ObjectStorage:
    case FitnessStorageType.S3Storage: {
      return S3FitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).saveFile(actor, fitnessFile)
    }
    default:
      return null
  }
}

export const getFitnessFile = async (
  database: Database,
  fileId: string,
  fileMetadata?: FitnessFile
) => {
  const { host } = getConfig()

  // Reuse metadata when already loaded by caller to avoid duplicate DB reads.
  const targetFileMetadata =
    fileMetadata ?? (await database.getFitnessFile({ id: fileId }))
  if (!targetFileMetadata) return null

  const fitnessStorage = getEffectiveFitnessStorageConfig()
  switch (fitnessStorage?.type) {
    case FitnessStorageType.LocalFile: {
      return LocalFileFitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).getFile(targetFileMetadata.path)
    }
    case FitnessStorageType.S3Storage:
    case FitnessStorageType.ObjectStorage: {
      return S3FitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).getFile(targetFileMetadata.path)
    }
    default:
      return null
  }
}

export const deleteFitnessFile = async (
  database: Database,
  fileId: string,
  fileMetadata?: FitnessFile
) => {
  const { host } = getConfig()

  const targetFileMetadata =
    fileMetadata ?? (await database.getFitnessFile({ id: fileId }))
  if (!targetFileMetadata) return false

  const fitnessStorage = getEffectiveFitnessStorageConfig()
  switch (fitnessStorage?.type) {
    case FitnessStorageType.LocalFile: {
      const storageDeleted = await LocalFileFitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).deleteFile(targetFileMetadata.path)

      if (storageDeleted) {
        await database.deleteFitnessFile({ id: fileId })
      }
      return storageDeleted
    }
    case FitnessStorageType.S3Storage:
    case FitnessStorageType.ObjectStorage: {
      const storageDeleted = await S3FitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).deleteFile(targetFileMetadata.path)

      if (storageDeleted) {
        await database.deleteFitnessFile({ id: fileId })
      }
      return storageDeleted
    }
    default:
      return false
  }
}

export const getPresignedFitnessFileUrl = async (
  database: Database,
  actor: Actor,
  input: {
    fileName: string
    contentType: string
    size: number
    importBatchId?: string
    description?: string
  }
) => {
  const { host } = getConfig()
  const fitnessStorage = getEffectiveFitnessStorageConfig()

  if (
    fitnessStorage?.type === FitnessStorageType.S3Storage ||
    fitnessStorage?.type === FitnessStorageType.ObjectStorage
  ) {
    return S3FitnessStorage.getStorage(
      fitnessStorage,
      host,
      database
    ).getPresignedForSaveFileUrl(actor, input)
  }

  return null
}

export const getFitnessFileBuffer = async (
  database: Database,
  fitnessFileId: string
): Promise<Buffer> => {
  const data = await getFitnessFile(database, fitnessFileId)
  if (!data) {
    throw new Error('Fitness file not found in storage')
  }

  if (data.type === 'buffer') {
    return data.buffer
  }

  const response = await fetch(data.redirectUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to download fitness file from redirect URL (${response.status})`
    )
  }

  return Buffer.from(await arrayBuffer(response))
}

const arrayBuffer = async (response: Response) => {
  if (typeof response.arrayBuffer === 'function') {
    return response.arrayBuffer()
  }
  // Fallback for older environments or specific polyfills if needed
  const chunks = []
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Response body is null')
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const result = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result.buffer
}

import { getConfig } from '@/lib/config'
import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { Actor } from '@/lib/types/domain/actor'

import { S3FitnessStorage } from './S3StorageFile'
import { LocalFileFitnessStorage } from './localFile'
import { FitnessFileUploadSchema } from './types'

export const saveFitnessFile = async (
  database: Database,
  actor: Actor,
  fitnessFile: FitnessFileUploadSchema
) => {
  const { fitnessStorage, host } = getConfig()
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
  const { fitnessStorage, host } = getConfig()

  // Reuse metadata when already loaded by caller to avoid duplicate DB reads.
  const targetFileMetadata =
    fileMetadata ?? (await database.getFitnessFile({ id: fileId }))
  if (!targetFileMetadata) return null

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
  const { fitnessStorage, host } = getConfig()

  const targetFileMetadata =
    fileMetadata ?? (await database.getFitnessFile({ id: fileId }))
  if (!targetFileMetadata) return false

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
  const { fitnessStorage, host } = getConfig()
  switch (fitnessStorage?.type) {
    case FitnessStorageType.S3Storage:
    case FitnessStorageType.ObjectStorage: {
      return S3FitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).getPresignedForSaveFileUrl(actor, input)
    }
    default:
      return null
  }
}

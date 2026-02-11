import { getConfig } from '@/lib/config'
import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

import { LocalFileFitnessStorage } from './localFile'
import { S3FitnessStorage } from './S3StorageFile'
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

export const getFitnessFile = async (database: Database, fileId: string) => {
  const { fitnessStorage, host } = getConfig()
  
  // Get file metadata from database
  const fileMetadata = await database.getFitnessFile({ id: fileId })
  if (!fileMetadata) return null

  switch (fitnessStorage?.type) {
    case FitnessStorageType.LocalFile: {
      return LocalFileFitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).getFile(fileMetadata.path)
    }
    case FitnessStorageType.S3Storage:
    case FitnessStorageType.ObjectStorage: {
      return S3FitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).getFile(fileMetadata.path)
    }
    default:
      return null
  }
}

export const deleteFitnessFile = async (database: Database, fileId: string) => {
  const { fitnessStorage, host } = getConfig()
  
  // Get file metadata from database
  const fileMetadata = await database.getFitnessFile({ id: fileId })
  if (!fileMetadata) return false

  let storageDeleted = false
  switch (fitnessStorage?.type) {
    case FitnessStorageType.LocalFile: {
      storageDeleted = await LocalFileFitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).deleteFile(fileMetadata.path)
      break
    }
    case FitnessStorageType.S3Storage:
    case FitnessStorageType.ObjectStorage: {
      storageDeleted = await S3FitnessStorage.getStorage(
        fitnessStorage,
        host,
        database
      ).deleteFile(fileMetadata.path)
      break
    }
    default:
      return false
  }

  if (storageDeleted) {
    await database.deleteFitnessFile({ id: fileId })
  }

  return storageDeleted
}

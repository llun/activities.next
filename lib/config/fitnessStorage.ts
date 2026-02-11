import { z } from 'zod'

import { matcher } from '@/lib/config/utils'

export enum FitnessStorageType {
  LocalFile = 'fs',
  ObjectStorage = 'object',
  S3Storage = 's3'
}

export const BaseFitnessStorageConfig = z.object({
  maxFileSize: z.number().nullish(),
  quotaPerAccount: z.number().nullish()
})
export type BaseFitnessStorageConfig = z.infer<typeof BaseFitnessStorageConfig>

export const FitnessStorageFileConfig = BaseFitnessStorageConfig.extend({
  type: z.literal(FitnessStorageType.LocalFile),
  path: z.string()
})
export type FitnessStorageFileConfig = z.infer<typeof FitnessStorageFileConfig>

export const FitnessStorageS3Config = BaseFitnessStorageConfig.extend({
  type: z.union([
    z.literal(FitnessStorageType.ObjectStorage),
    z.literal(FitnessStorageType.S3Storage)
  ]),
  bucket: z.string(),
  region: z.string(),
  hostname: z.string().optional(),
  prefix: z.string()
})
export type FitnessStorageS3Config = z.infer<typeof FitnessStorageS3Config>

export const FitnessStorageConfig = z.union([
  FitnessStorageFileConfig,
  FitnessStorageS3Config
])
export type FitnessStorageConfig = z.infer<typeof FitnessStorageConfig>

// Maximum file size is 50 MB for fitness files
export const DEFAULT_FITNESS_MAX_FILE_SIZE = 52_428_800

const parseIntegerEnv = (value: string | undefined): number | undefined => {
  if (typeof value === 'undefined') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

const getFitnessMaxFileSize = (): number =>
  parseIntegerEnv(process.env.ACTIVITIES_FITNESS_STORAGE_MAX_FILE_SIZE) ??
  DEFAULT_FITNESS_MAX_FILE_SIZE

const getFitnessQuotaPerAccount = (): number | undefined =>
  parseIntegerEnv(process.env.ACTIVITIES_FITNESS_STORAGE_QUOTA_PER_ACCOUNT)

const getMediaQuotaPerAccount = (): number | undefined =>
  parseIntegerEnv(process.env.ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT)

export const getFitnessStorageConfig = (): {
  fitnessStorage: FitnessStorageConfig
} | null => {
  const hasEnvironmentFitnessStorage = matcher('ACTIVITIES_FITNESS_STORAGE_')
  if (!hasEnvironmentFitnessStorage) {
    // Fall back to media storage config with different path/prefix
    const hasEnvironmentMediaStorage = matcher('ACTIVITIES_MEDIA_STORAGE_')
    if (!hasEnvironmentMediaStorage) return null

    switch (process.env.ACTIVITIES_MEDIA_STORAGE_TYPE) {
      case FitnessStorageType.LocalFile:
        return {
          fitnessStorage: {
            type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
            path: process.env.ACTIVITIES_MEDIA_STORAGE_PATH
              ? `${process.env.ACTIVITIES_MEDIA_STORAGE_PATH}/fitness`
              : 'uploads/fitness',
            maxFileSize: getFitnessMaxFileSize(),
            quotaPerAccount: getMediaQuotaPerAccount()
          }
        }
      case FitnessStorageType.S3Storage:
      case FitnessStorageType.ObjectStorage: {
        return {
          fitnessStorage: {
            type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
            bucket: process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET as string,
            region: process.env.ACTIVITIES_MEDIA_STORAGE_REGION as string,
            hostname:
              process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME || undefined,
            prefix: 'fitness/',
            maxFileSize: getFitnessMaxFileSize(),
            quotaPerAccount: getMediaQuotaPerAccount()
          }
        }
      }
      default:
        return null
    }
  }

  switch (process.env.ACTIVITIES_FITNESS_STORAGE_TYPE) {
    case FitnessStorageType.LocalFile:
      return {
        fitnessStorage: {
          type: process.env.ACTIVITIES_FITNESS_STORAGE_TYPE,
          path: process.env.ACTIVITIES_FITNESS_STORAGE_PATH as string,
          maxFileSize: getFitnessMaxFileSize(),
          quotaPerAccount: getFitnessQuotaPerAccount()
        }
      }
    case FitnessStorageType.S3Storage:
    case FitnessStorageType.ObjectStorage: {
      return {
        fitnessStorage: {
          type: process.env.ACTIVITIES_FITNESS_STORAGE_TYPE,
          bucket: process.env.ACTIVITIES_FITNESS_STORAGE_BUCKET as string,
          region: process.env.ACTIVITIES_FITNESS_STORAGE_REGION as string,
          hostname:
            process.env.ACTIVITIES_FITNESS_STORAGE_HOSTNAME || undefined,
          prefix: process.env.ACTIVITIES_FITNESS_STORAGE_PREFIX || 'fitness/',
          maxFileSize: getFitnessMaxFileSize(),
          quotaPerAccount: getFitnessQuotaPerAccount()
        }
      }
    }
    default:
      return null
  }
}

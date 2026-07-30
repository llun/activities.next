import path from 'path'
import { z } from 'zod'

import { requiredStorageValue } from '@/lib/config/storageValue'
import { matcher } from '@/lib/config/utils'
import { logger } from '@/lib/utils/logger'

export enum FitnessStorageType {
  LocalFile = 'fs',
  ObjectStorage = 'object',
  S3Storage = 's3'
}

export const BaseFitnessStorageConfig = z.object({
  maxFileSize: z.number().nullish(),
  quotaPerAccount: z.number().nullish(),
  mapboxAccessToken: z.string().nullish()
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
  endpoint: z.string().optional(),
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

const getMapboxAccessToken = (): string | undefined => {
  const token = process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN
  if (!token) return undefined
  const trimmed = token.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Whether the operator configured fitness storage in its own right, rather than
 * leaving it to inherit media storage.
 *
 * `getFitnessStorageConfig` returning `null` is ambiguous on its own: it covers
 * both "never configured" and "configured, but disabled because a required
 * value was blank or the type was unrecognised". Only the first may fall back
 * to media storage — falling back in the second case would quietly write
 * fitness files into the media bucket right after warning that fitness storage
 * is disabled. `getEffectiveFitnessStorageConfig` uses this to tell them apart.
 */
export const hasExplicitFitnessStorageType = (): boolean =>
  Boolean(process.env.ACTIVITIES_FITNESS_STORAGE_TYPE)

export const getFitnessStorageConfig = (): {
  fitnessStorage: FitnessStorageConfig
} | null => {
  const fitnessStorageType = process.env.ACTIVITIES_FITNESS_STORAGE_TYPE
  if (!fitnessStorageType) {
    // Fall back to media storage config with different path/prefix
    const hasEnvironmentMediaStorage = matcher('ACTIVITIES_MEDIA_STORAGE_')
    if (!hasEnvironmentMediaStorage) return null

    switch (process.env.ACTIVITIES_MEDIA_STORAGE_TYPE) {
      case FitnessStorageType.LocalFile: {
        // The same guard as the media resolver, because this is the same
        // variable. A blank value used to fall through to `|| 'uploads'` and
        // resolve against the process CWD, rooting fitness uploads inside the
        // application directory.
        const mediaPath = requiredStorageValue(
          'ACTIVITIES_MEDIA_STORAGE_PATH',
          'fitness storage'
        )
        if (mediaPath === null) return null
        return {
          fitnessStorage: {
            type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
            path: path.join(mediaPath ?? 'uploads', 'fitness'),
            maxFileSize: getFitnessMaxFileSize(),
            quotaPerAccount: getMediaQuotaPerAccount(),
            mapboxAccessToken: getMapboxAccessToken()
          }
        }
      }
      case FitnessStorageType.S3Storage:
      case FitnessStorageType.ObjectStorage: {
        const mediaBucket = requiredStorageValue(
          'ACTIVITIES_MEDIA_STORAGE_BUCKET',
          'fitness storage'
        )
        const mediaRegion = requiredStorageValue(
          'ACTIVITIES_MEDIA_STORAGE_REGION',
          'fitness storage'
        )
        if (mediaBucket === null || mediaRegion === null) return null
        return {
          fitnessStorage: {
            type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
            bucket: mediaBucket as string,
            region: mediaRegion as string,
            hostname:
              process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME || undefined,
            endpoint:
              process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT || undefined,
            prefix: 'fitness/',
            maxFileSize: getFitnessMaxFileSize(),
            quotaPerAccount: getMediaQuotaPerAccount(),
            mapboxAccessToken: getMapboxAccessToken()
          }
        }
      }
      default:
        return null
    }
  }

  // Fitness's own variables need the same guard as the media ones they replace:
  // a blank value here reaches the identical `path.resolve('')`.
  switch (fitnessStorageType) {
    case FitnessStorageType.LocalFile: {
      const storagePath = requiredStorageValue(
        'ACTIVITIES_FITNESS_STORAGE_PATH',
        'fitness storage'
      )
      if (storagePath === null) return null
      return {
        fitnessStorage: {
          type: fitnessStorageType,
          // Unset stays `undefined` so `Config.parse` still rejects it loudly.
          path: storagePath as string,
          maxFileSize: getFitnessMaxFileSize(),
          quotaPerAccount: getFitnessQuotaPerAccount(),
          mapboxAccessToken: getMapboxAccessToken()
        }
      }
    }
    case FitnessStorageType.S3Storage:
    case FitnessStorageType.ObjectStorage: {
      const bucket = requiredStorageValue(
        'ACTIVITIES_FITNESS_STORAGE_BUCKET',
        'fitness storage'
      )
      const region = requiredStorageValue(
        'ACTIVITIES_FITNESS_STORAGE_REGION',
        'fitness storage'
      )
      if (bucket === null || region === null) return null
      return {
        fitnessStorage: {
          type: fitnessStorageType,
          bucket: bucket as string,
          region: region as string,
          hostname:
            process.env.ACTIVITIES_FITNESS_STORAGE_HOSTNAME || undefined,
          endpoint:
            process.env.ACTIVITIES_FITNESS_STORAGE_ENDPOINT || undefined,
          prefix: process.env.ACTIVITIES_FITNESS_STORAGE_PREFIX || 'fitness/',
          maxFileSize: getFitnessMaxFileSize(),
          quotaPerAccount: getFitnessQuotaPerAccount(),
          mapboxAccessToken: getMapboxAccessToken()
        }
      }
    }
    default:
      // An explicitly configured type no longer falls back to media storage, so
      // a typo here disables fitness storage outright. Say so rather than
      // leaving the operator to notice that uploads stopped.
      logger.warn(
        `Unknown ACTIVITIES_FITNESS_STORAGE_TYPE value "${fitnessStorageType}"; fitness storage will be disabled`
      )
      return null
  }
}

/**
 * Path segments under the media storage root that belong to fitness files and
 * must never be served by the media route.
 *
 * Fitness storage falls back to media storage when `ACTIVITIES_FITNESS_STORAGE_TYPE`
 * is unset — which is the default — and both fallbacks land inside the media
 * root: S3/object storage under a `fitness/` key prefix in the same bucket, and
 * local storage in a `fitness` directory under `ACTIVITIES_MEDIA_STORAGE_PATH`.
 * `GET /api/v1/files/<path>` has no access control at all and redirects to the
 * public CDN hostname when one is configured, so without this reservation it is
 * a way around the owner-only gate on `GET /api/v1/fitness-files/:id`.
 *
 * Media objects are written under `medias/` — including fitness route maps and
 * their JPEG email copies, which go through `saveMedia` — so reserving these
 * costs nothing legitimate. The configurable prefix is included as well: an
 * explicitly configured backend usually points somewhere the media route cannot
 * reach, but an operator is free to aim both at the same bucket.
 */
export const getMediaReservedFitnessPathPrefixes = (): string[] => {
  // Returned as PREFIXES rather than single segments because the configurable
  // one is free to be nested (`activities/fitness/`); the caller matches on a
  // path-segment boundary so `fitnessed/` is not caught by `fitness`.
  const configuredPrefix = (
    process.env.ACTIVITIES_FITNESS_STORAGE_PREFIX || ''
  ).replace(/^\/+|\/+$/g, '')

  return [
    ...new Set(
      ['fitness', configuredPrefix, getLocalFitnessPathUnderMediaRoot()]
        .map((prefix) => prefix.toLowerCase())
        .filter(Boolean)
    )
  ]
}

/**
 * The relative path of an explicitly configured LOCAL fitness directory, when it
 * sits inside the media root — otherwise an empty string.
 *
 * `ACTIVITIES_FITNESS_STORAGE_PREFIX` above only covers the S3/object shape. An
 * operator who sets `ACTIVITIES_FITNESS_STORAGE_TYPE=fs` names the directory
 * with `ACTIVITIES_FITNESS_STORAGE_PATH` instead, and nothing stops that landing
 * under `ACTIVITIES_MEDIA_STORAGE_PATH` beside `medias/` under some other name.
 * `LocalFileStorage.getFile` serves anything below the media root — it requires
 * no `medias` row — so that directory would be readable through the media route
 * with no access control, which is the hole this whole reservation exists to
 * close. It just would not have been called `fitness`.
 */
const getLocalFitnessPathUnderMediaRoot = (): string => {
  if (
    process.env.ACTIVITIES_FITNESS_STORAGE_TYPE !== FitnessStorageType.LocalFile
  ) {
    return ''
  }

  const fitnessPath = process.env.ACTIVITIES_FITNESS_STORAGE_PATH
  const mediaPath = process.env.ACTIVITIES_MEDIA_STORAGE_PATH
  if (!fitnessPath || !mediaPath) return ''

  const resolvedFitnessPath = path.resolve(fitnessPath)
  const resolvedMediaPath = path.resolve(mediaPath)
  const relativePath = path.relative(resolvedMediaPath, resolvedFitnessPath)

  // Outside the media root (`..`), or the root itself (''), reserves nothing:
  // the media route cannot reach the first, and reserving the second would
  // refuse every media object on the instance.
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    return ''
  }

  return relativePath.split(path.sep).join('/')
}

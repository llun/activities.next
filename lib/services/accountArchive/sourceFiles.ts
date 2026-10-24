import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import { Readable } from 'stream'

import { getConfig } from '@/lib/config'
import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { getEffectiveFitnessStorageConfig } from '@/lib/services/fitness-files'
import { resolveStorageFilePath } from '@/lib/services/medias/storagePath'
import { createStorageS3Client } from '@/lib/services/storage/s3Client'

export type SourceKind = 'media' | 'fitness'

export type SourceFile = { stream: Readable; size: number | null }

/**
 * What can go wrong reading one stored file, without the storage's own words:
 * the driver's message can name the bucket, endpoint or a local directory, and
 * the warning it ends up in is written into the archive the user downloads.
 */
export type SourceFileOutcome =
  | { ok: true; file: SourceFile }
  | {
      ok: false
      reason: 'not-configured' | 'refused-path' | 'missing' | 'failed'
    }

const clients = new Map<string, S3Client>()

const getClient = (config: { region: string; endpoint?: string }) => {
  const cacheKey = `${config.region}|${config.endpoint ?? ''}`
  let client = clients.get(cacheKey)
  if (!client) {
    client = createStorageS3Client(config)
    clients.set(cacheKey, client)
  }
  return client
}

const errorName = (error: unknown) => (error as { name?: string }).name

const openLocal = async (
  root: string,
  relativePath: string
): Promise<SourceFileOutcome> => {
  // The same containment check the storage drivers use: a stored path is data
  // from a row, and one that leaves the storage root is never read.
  const target = resolveStorageFilePath(root, relativePath)
  if (!target) return { ok: false, reason: 'refused-path' }
  try {
    const stat = await fs.stat(target)
    if (!stat.isFile()) return { ok: false, reason: 'missing' }
    return {
      ok: true,
      file: { stream: createReadStream(target), size: stat.size }
    }
  } catch (error) {
    return {
      ok: false,
      reason:
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'missing'
          : 'failed'
    }
  }
}

const openObject = async (
  client: S3Client,
  bucket: string,
  key: string
): Promise<SourceFileOutcome> => {
  try {
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    )
    if (!object.Body) return { ok: false, reason: 'missing' }
    const stream =
      object.Body instanceof Readable
        ? object.Body
        : Readable.fromWeb(
            object.Body.transformToWebStream() as Parameters<
              typeof Readable.fromWeb
            >[0]
          )
    return {
      ok: true,
      file: {
        stream,
        size:
          typeof object.ContentLength === 'number' ? object.ContentLength : null
      }
    }
  } catch (error) {
    return {
      ok: false,
      reason:
        errorName(error) === 'NoSuchKey' || errorName(error) === 'NotFound'
          ? 'missing'
          : 'failed'
    }
  }
}

/** Opens a stored media file (`medias.original`, a thumbnail, an edit render). */
export const openMediaSourceFile = async (
  storagePath: string
): Promise<SourceFileOutcome> => {
  const { mediaStorage } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile:
      return openLocal(mediaStorage.path, storagePath)
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage:
      return openObject(
        getClient(mediaStorage),
        mediaStorage.bucket,
        storagePath
      )
    default:
      return { ok: false, reason: 'not-configured' }
  }
}

/** Opens a stored fitness file (the original .fit/.gpx/.tcx upload). */
export const openFitnessSourceFile = async (
  storagePath: string
): Promise<SourceFileOutcome> => {
  const fitnessStorage = getEffectiveFitnessStorageConfig()
  switch (fitnessStorage?.type) {
    case FitnessStorageType.LocalFile:
      return openLocal(fitnessStorage.path, storagePath)
    case FitnessStorageType.S3Storage:
    case FitnessStorageType.ObjectStorage:
      return openObject(
        getClient(fitnessStorage),
        fitnessStorage.bucket,
        fitnessStorage.prefix
          ? `${fitnessStorage.prefix}${storagePath}`
          : storagePath
      )
    default:
      return { ok: false, reason: 'not-configured' }
  }
}

export const openSourceFile = (kind: SourceKind, storagePath: string) =>
  kind === 'media'
    ? openMediaSourceFile(storagePath)
    : openFitnessSourceFile(storagePath)

export const describeSourceFailure = (
  reason: Extract<SourceFileOutcome, { ok: false }>['reason']
) => {
  switch (reason) {
    case 'not-configured':
      return 'storage is not configured'
    case 'refused-path':
      return 'the stored path is outside the storage root'
    case 'missing':
      return 'the file is missing from storage'
    default:
      return 'the file could not be read from storage'
  }
}

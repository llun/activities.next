import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import { Readable } from 'stream'

import { getConfig } from '@/lib/config'
import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { ARCHIVE_SOURCE_IDLE_TIMEOUT_MS } from '@/lib/services/accountArchive/constants'
import { ARCHIVE_S3_REQUEST_TIMEOUT_MS } from '@/lib/services/accountArchive/objectStore'
import { getEffectiveFitnessStorageConfig } from '@/lib/services/fitness-files'
import {
  isObjectStorageMediaKey,
  isReservedFitnessMediaPath
} from '@/lib/services/medias/reservedPaths'
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
    client = createStorageS3Client({
      ...config,
      requestTimeoutMs: ARCHIVE_S3_REQUEST_TIMEOUT_MS
    })
    clients.set(cacheKey, client)
  }
  return client
}

const errorName = (error: unknown) => (error as { name?: string }).name

// The retryable S3 error codes of the AWS SDK (smithy service-error
// classification), copied here because that package is only a transitive
// dependency.
const TRANSIENT_ERROR_NAMES = new Set([
  // Clock skew and expired credentials: a later attempt gets past them.
  'AuthFailure',
  'InvalidSignatureException',
  'RequestExpired',
  'RequestInTheFuture',
  'RequestTimeTooSkewed',
  'SignatureDoesNotMatch',
  'ExpiredToken',
  'ExpiredTokenException',
  // Throttling.
  'BandwidthLimitExceeded',
  'EC2ThrottledException',
  'LimitExceededException',
  'PriorRequestNotComplete',
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
  'RequestThrottled',
  'RequestThrottledException',
  'SlowDown',
  'ThrottledException',
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
  'TransactionInProgressException',
  // Transient server and network errors.
  'TimeoutError',
  'RequestTimeout',
  'RequestTimeoutException',
  'InternalError',
  'ServiceUnavailable'
])

/**
 * An error that a later attempt can get past: a server error, throttling, clock
 * skew, a timeout, or a network failure with no answer at all. The clients of
 * an export make a single attempt, so these must not be mistaken for a file
 * that cannot be read: the error is rethrown, the slice fails and the queue
 * retries it. A final answer (access denied, bad request) stays a skipped file.
 */
const isTransientStorageError = (error: unknown) => {
  if (TRANSIENT_ERROR_NAMES.has(errorName(error) ?? '')) return true
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode
  if (status === undefined) return true
  return status >= 500 || status === 429 || status === 408
}

/** Errors of the local disk that a later attempt can get past. */
const TRANSIENT_FS_CODES = new Set([
  'EIO',
  'ESTALE',
  'ETIMEDOUT',
  'EAGAIN',
  'EBUSY',
  'EMFILE',
  'ENFILE'
])

/**
 * Reads `stream` and gives up when it sends nothing for `idleMs`: the request
 * timeout of the client stops at the response headers, so a body that stalls
 * would otherwise be waited for for ever. Only the wait for the next chunk is
 * timed, not the time the caller spends with a chunk (an upload of a part).
 */
export async function* readWithIdleTimeout(
  stream: Readable,
  idleMs: number = ARCHIVE_SOURCE_IDLE_TIMEOUT_MS
): AsyncGenerator<Buffer> {
  const iterator = stream[Symbol.asyncIterator]()
  try {
    for (;;) {
      let timer: NodeJS.Timeout | undefined
      const idle = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(new Error('The source file stopped sending data'), {
              name: 'TimeoutError'
            })
          )
        }, idleMs)
      })
      let next: IteratorResult<unknown>
      try {
        next = await Promise.race([iterator.next(), idle])
      } finally {
        clearTimeout(timer)
      }
      if (next.done) return
      yield Buffer.isBuffer(next.value)
        ? next.value
        : Buffer.from(next.value as string)
    }
  } finally {
    stream.destroy()
  }
}

const openLocal = async (
  root: string,
  relativePath: string,
  start: number
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
      file: {
        stream: createReadStream(target, { start }),
        size: stat.size
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code && TRANSIENT_FS_CODES.has(code)) throw error
    return {
      ok: false,
      reason: code === 'ENOENT' ? 'missing' : 'failed'
    }
  }
}

const openObject = async (
  client: S3Client,
  bucket: string,
  key: string,
  start: number
): Promise<SourceFileOutcome> => {
  try {
    const object = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(start > 0 ? { Range: `bytes=${start}-` } : {})
      })
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
    // A resume at the very end of the object: nothing is left to copy.
    if (start > 0 && errorName(error) === 'InvalidRange') {
      return { ok: true, file: { stream: Readable.from([]), size: 0 } }
    }
    if (isTransientStorageError(error)) throw error
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
  storagePath: string,
  start = 0
): Promise<SourceFileOutcome> => {
  // Media lives under `medias/` and never under the reserved prefixes (other
  // accounts' exports, private fitness originals). A URL that names anything
  // else is refused, whoever wrote it.
  if (
    isReservedFitnessMediaPath(storagePath) ||
    !isObjectStorageMediaKey(storagePath)
  ) {
    return { ok: false, reason: 'refused-path' }
  }
  const { mediaStorage } = getConfig()
  switch (mediaStorage?.type) {
    case MediaStorageType.LocalFile:
      return openLocal(mediaStorage.path, storagePath, start)
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage:
      return openObject(
        getClient(mediaStorage),
        mediaStorage.bucket,
        storagePath,
        start
      )
    default:
      return { ok: false, reason: 'not-configured' }
  }
}

/** Opens a stored fitness file (the original .fit/.gpx/.tcx upload). */
export const openFitnessSourceFile = async (
  storagePath: string,
  start = 0
): Promise<SourceFileOutcome> => {
  const fitnessStorage = getEffectiveFitnessStorageConfig()
  switch (fitnessStorage?.type) {
    case FitnessStorageType.LocalFile:
      return openLocal(fitnessStorage.path, storagePath, start)
    case FitnessStorageType.S3Storage:
    case FitnessStorageType.ObjectStorage:
      return openObject(
        getClient(fitnessStorage),
        fitnessStorage.bucket,
        fitnessStorage.prefix
          ? `${fitnessStorage.prefix}${storagePath}`
          : storagePath,
        start
      )
    default:
      return { ok: false, reason: 'not-configured' }
  }
}

export const openSourceFile = (
  kind: SourceKind,
  storagePath: string,
  start = 0
) =>
  kind === 'media'
    ? openMediaSourceFile(storagePath, start)
    : openFitnessSourceFile(storagePath, start)

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

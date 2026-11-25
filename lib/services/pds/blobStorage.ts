import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client
} from '@aws-sdk/client-s3'
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

import { getConfig } from '@/lib/config'
import {
  type MediaStorageConfig,
  type MediaStorageFileConfig,
  type MediaStorageS3Config,
  MediaStorageType
} from '@/lib/config/mediaStorage'
import type { Database } from '@/lib/database/types'
import { assertStorageFilePath } from '@/lib/services/medias/storagePath'
import { createStorageS3Client } from '@/lib/services/storage/s3Client'
import { logger } from '@/lib/utils/logger'
import {
  PDS_BLOB_STORAGE_KEY_HKDF_INFO,
  deriveSecretKey
} from '@/lib/utils/secretBox'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { PDS_BLOB_STORAGE_PREFIX } from './constants'
import { PdsStorageNotConfiguredError, PdsValidationError } from './errors'
import { withPdsRepoLock } from './lock'
import { getSafePdsBlobContentHeaders } from './xrpc'

// Storage-only half of the PDS blob code: object-store put/get/delete, the
// storage-key computation and the deletion helpers. It deliberately imports no
// `@atproto/*` or `multiformats` module, because the job registry and the
// database layer reach it from CommonJS (scripts via `scripts/run.cjs`, the
// `tsx/cjs` guard tests), where those ESM-only packages fail to resolve. CID
// computation and the upload/read paths that need it stay in `blobs.ts`.

export const PDS_BLOB_S3_REQUEST_TIMEOUT_MS = 60 * 1000
// Hold the per-DID repo lock longer than an S3 request can stay in flight so
// the lock never expires mid-upload or mid-purge.
export const PDS_BLOB_REPO_LOCK_TTL_MS =
  PDS_BLOB_S3_REQUEST_TIMEOUT_MS + 30 * 1000

// Every upload gets its own key: `<cid>.<16 random hex>`. The random suffix is
// what makes a late delete safe — a delete only ever names the exact key of the
// row it removed, so it can never remove a newer upload of the same bytes.
const PDS_BLOB_KEY_PATTERN = new RegExp(
  `^${PDS_BLOB_STORAGE_PREFIX}/[a-f0-9]{64}/[A-Za-z0-9]+\\.[a-f0-9]{16}$`
)

const isNotFoundFsError = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'

const isNotFoundS3Error = (error: unknown): boolean => {
  const e = error as {
    name?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404
  )
}

export const assertPdsBlobKey = (key: string): string => {
  if (!PDS_BLOB_KEY_PATTERN.test(key) || key.split('/').includes('..')) {
    throw new PdsValidationError('Invalid PDS blob storage key')
  }
  return key
}

export const getPdsBlobStorageKey = (
  did: string,
  cid: string,
  options: { secretPhase?: string } = {}
): string => {
  const hmacKey = deriveSecretKey({
    info: PDS_BLOB_STORAGE_KEY_HKDF_INFO,
    secretPhase: options.secretPhase
  })
  const didHmac = crypto.createHmac('sha256', hmacKey).update(did).digest('hex')
  const uniqueSuffix = crypto.randomBytes(8).toString('hex')
  return assertPdsBlobKey(
    `${PDS_BLOB_STORAGE_PREFIX}/${didHmac}/${cid}.${uniqueSuffix}`
  )
}

export interface PdsBlobObjectStore {
  put(key: string, bytes: Buffer, mimeType: string): Promise<void>
  openRead(key: string): Promise<Readable | null>
  delete(key: string): Promise<void>
}

export class FilePdsBlobObjectStore implements PdsBlobObjectStore {
  constructor(private readonly config: MediaStorageFileConfig) {}

  private resolve(key: string): string {
    return assertStorageFilePath(this.config.path, assertPdsBlobKey(key))
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const target = this.resolve(key)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.${crypto.randomBytes(6).toString('hex')}.partial`
    try {
      await fs.writeFile(temporary, bytes)
      await fs.rename(temporary, target)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async openRead(key: string): Promise<Readable | null> {
    const target = this.resolve(key)
    try {
      await fs.access(target)
    } catch (error) {
      if (isNotFoundFsError(error)) return null
      throw error
    }
    return createReadStream(target)
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key)
    await fs.rm(target, { force: true })
  }
}

export class S3PdsBlobObjectStore implements PdsBlobObjectStore {
  constructor(
    private readonly config: MediaStorageS3Config,
    private readonly client: S3Client = createStorageS3Client({
      ...config,
      requestTimeoutMs: PDS_BLOB_S3_REQUEST_TIMEOUT_MS
    })
  ) {}

  async put(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    const { contentType, contentDisposition } =
      getSafePdsBlobContentHeaders(mimeType)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: assertPdsBlobKey(key),
        Body: bytes,
        ContentType: contentType,
        ...(contentDisposition
          ? { ContentDisposition: contentDisposition }
          : {})
      })
    )
  }

  async openRead(key: string): Promise<Readable | null> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: assertPdsBlobKey(key)
        })
      )
      if (!object.Body) return null
      return object.Body instanceof Readable
        ? object.Body
        : Readable.fromWeb(
            object.Body.transformToWebStream() as Parameters<
              typeof Readable.fromWeb
            >[0]
          )
    } catch (error) {
      if (isNotFoundS3Error(error)) return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: assertPdsBlobKey(key)
      })
    )
  }
}

export const createPdsBlobObjectStore = (
  storage: MediaStorageConfig | undefined | null
): PdsBlobObjectStore | null => {
  switch (storage?.type) {
    case MediaStorageType.LocalFile:
      return new FilePdsBlobObjectStore(storage)
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage:
      return new S3PdsBlobObjectStore(storage)
    default:
      return null
  }
}

export const getPdsBlobObjectStore = (): PdsBlobObjectStore | null =>
  createPdsBlobObjectStore(getConfig().mediaStorage)

export const resolvePdsBlobObjectStore = (
  store?: PdsBlobObjectStore
): PdsBlobObjectStore => {
  const resolved = store ?? getPdsBlobObjectStore()
  if (!resolved) {
    throw new PdsStorageNotConfiguredError()
  }
  return resolved
}

export const deletePdsBlobFiles = async (
  storageKeys: string[],
  options: { store?: PdsBlobObjectStore } = {}
): Promise<void> => {
  if (storageKeys.length === 0) return
  const store = options.store ?? getPdsBlobObjectStore()
  if (!store) return
  for (const key of storageKeys) {
    await store.delete(key)
  }
}

export const deletePdsBlobFilesBestEffort = async (
  storageKeys: string[],
  options: {
    store?: PdsBlobObjectStore
    context?: Record<string, unknown>
  } = {}
): Promise<void> => {
  if (storageKeys.length === 0) return
  const store = options.store ?? getPdsBlobObjectStore()
  if (!store) return
  for (const key of storageKeys) {
    try {
      await store.delete(key)
    } catch (err) {
      logger.error({
        message: 'Failed to delete PDS blob file',
        storageKey: key,
        ...options.context,
        err: toLoggableError(err)
      })
    }
  }
}

/**
 * Removes an actor's PDS blob files before `deleteActorData` deletes the
 * `pds_*` rows. It runs while the actor is still `scheduled`, like the archive
 * and import purges, so a storage error propagates and the job retries with
 * the rows intact. A cancel that lands after a partial purge keeps rows whose
 * files are gone; no repo can be created before D2.3, which owns turning a
 * repo off, deleting it and this edge.
 */
export const purgeActorPdsBlobs = async ({
  database,
  actorId,
  store = getPdsBlobObjectStore()
}: {
  database: Database
  actorId: string
  store?: PdsBlobObjectStore | null
}): Promise<void> => {
  const repo = await database.getPdsRepo({ actorId })
  if (!repo) return
  await withPdsRepoLock(
    database,
    repo.did,
    async () => {
      const storageKeys = await database.listPdsBlobStorageKeys({
        did: repo.did
      })
      if (storageKeys.length === 0) return
      // Without a store the files can't be removed; throwing keeps the rows (and
      // so the keys) and lets the deletion job retry once storage is back.
      if (!store) throw new PdsStorageNotConfiguredError()
      await deletePdsBlobFiles(storageKeys, { store })
    },
    { ttlMs: PDS_BLOB_REPO_LOCK_TTL_MS }
  )
}

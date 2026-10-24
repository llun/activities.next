import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createReadStream, createWriteStream } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { PassThrough, Readable } from 'stream'
import { pipeline } from 'stream/promises'

import { getConfig } from '@/lib/config'
import {
  MediaStorageConfig,
  MediaStorageFileConfig,
  MediaStorageS3Config,
  MediaStorageType
} from '@/lib/config/mediaStorage'
import { assertStorageFilePath } from '@/lib/services/medias/storagePath'
import { createStorageS3Client } from '@/lib/services/storage/s3Client'

import { ARCHIVE_STORAGE_PREFIX } from './constants'

/** A short-lived link to the finished file on object storage. */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60
const DELETE_BATCH_SIZE = 1000

const KEY_PATTERN = new RegExp(`^${ARCHIVE_STORAGE_PREFIX}(/[A-Za-z0-9._-]+)+$`)
const PREFIX_PATTERN = new RegExp(
  `^${ARCHIVE_STORAGE_PREFIX}(/[A-Za-z0-9._-]+)*/?$`
)

/**
 * Every key this store touches is under `archives/` and made of plain segments,
 * whatever called it: the id in it comes from a database row, and the same
 * check guards the local driver's path and the S3 key.
 */
export const assertArchiveKey = (key: string): string => {
  if (!KEY_PATTERN.test(key) || key.split('/').includes('..')) {
    throw new Error('Invalid archive storage key')
  }
  return key
}

const assertArchivePrefix = (prefix: string): string => {
  if (!PREFIX_PATTERN.test(prefix) || prefix.split('/').includes('..')) {
    throw new Error('Invalid archive storage prefix')
  }
  return prefix
}

export const getArchiveStorageKey = (archiveId: string, ...rest: string[]) =>
  assertArchiveKey([ARCHIVE_STORAGE_PREFIX, archiveId, ...rest].join('/'))

export interface ArchiveWriteSink {
  stream: PassThrough
  /** Settles once everything written is durable; resolves with the byte count. */
  done: Promise<number>
}

/**
 * Where export files and the parts staged between job slices live: the media
 * storage's `archives/` prefix, on the local disk or in the bucket. These files
 * are not media: the public files route refuses the prefix, and a download goes
 * through an owner-only endpoint.
 */
export interface ArchiveObjectStore {
  put(key: string, body: Buffer | string): Promise<void>
  get(key: string): Promise<Buffer | null>
  openRead(key: string): Promise<Readable | null>
  openWrite(key: string): ArchiveWriteSink
  delete(key: string): Promise<void>
  /** Deletes every object under `prefix` (`archives/<id>/` for one export). */
  deletePrefix(prefix: string): Promise<void>
  size(key: string): Promise<number | null>
  /**
   * A signed, short-lived URL for the object when the storage can serve one
   * itself (object storage); null for the local disk, which the download
   * endpoint streams.
   */
  getDownloadUrl(
    key: string,
    options: { fileName: string }
  ): Promise<string | null>
}

const isNotFound = (error: unknown) =>
  (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'

export class FileArchiveObjectStore implements ArchiveObjectStore {
  constructor(private readonly config: MediaStorageFileConfig) {}

  private resolve(key: string) {
    return assertStorageFilePath(this.config.path, assertArchiveKey(key))
  }

  async put(key: string, body: Buffer | string) {
    const target = this.resolve(key)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.partial`
    await fs.writeFile(temporary, body)
    await fs.rename(temporary, target)
  }

  async get(key: string) {
    try {
      return await fs.readFile(this.resolve(key))
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async openRead(key: string) {
    const target = this.resolve(key)
    try {
      await fs.access(target)
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
    return createReadStream(target)
  }

  openWrite(key: string): ArchiveWriteSink {
    const target = this.resolve(key)
    const temporary = `${target}.partial`
    const stream = new PassThrough()
    const done = (async () => {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await pipeline(stream, createWriteStream(temporary))
      const { size } = await fs.stat(temporary)
      await fs.rename(temporary, target)
      return size
    })()
    // A write that fails before the caller awaits `done` must not crash the
    // process as an unhandled rejection; the caller still sees it.
    done.catch(() => undefined)
    return { stream, done }
  }

  async delete(key: string) {
    const target = this.resolve(key)
    await fs.rm(target, { force: true })
    await fs.rm(`${target}.partial`, { force: true })
  }

  async deletePrefix(prefix: string) {
    const target = assertStorageFilePath(
      this.config.path,
      assertArchivePrefix(prefix).replace(/\/$/, '')
    )
    // Never the `archives/` root itself.
    if (
      target === assertStorageFilePath(this.config.path, ARCHIVE_STORAGE_PREFIX)
    ) {
      throw new Error('Refusing to delete the whole archive prefix')
    }
    await fs.rm(target, { recursive: true, force: true })
  }

  async size(key: string) {
    try {
      return (await fs.stat(this.resolve(key))).size
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async getDownloadUrl() {
    return null
  }
}

export class S3ArchiveObjectStore implements ArchiveObjectStore {
  constructor(
    private readonly config: MediaStorageS3Config,
    private readonly client: S3Client = createStorageS3Client(config)
  ) {}

  async put(key: string, body: Buffer | string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: assertArchiveKey(key),
        Body: body
      })
    )
  }

  async get(key: string) {
    try {
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: assertArchiveKey(key)
        })
      )
      if (!object.Body) return null
      return Buffer.from(await object.Body.transformToByteArray())
    } catch (error) {
      if ((error as Error).name === 'NoSuchKey') return null
      throw error
    }
  }

  async openRead(key: string) {
    try {
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: assertArchiveKey(key)
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
      if ((error as Error).name === 'NoSuchKey') return null
      throw error
    }
  }

  openWrite(key: string): ArchiveWriteSink {
    const stream = new PassThrough()
    let bytes = 0
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length
    })
    // A multipart upload, so an archive of any size streams through without
    // being held in memory or on disk.
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.config.bucket,
        Key: assertArchiveKey(key),
        Body: stream,
        ContentType: key.endsWith('.zip')
          ? 'application/zip'
          : 'application/octet-stream'
      }
    })
    const done = upload.done().then(() => bytes)
    done.catch(() => undefined)
    return { stream, done }
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: assertArchiveKey(key)
      })
    )
  }

  async deletePrefix(prefix: string) {
    const normalized = assertArchivePrefix(prefix)
    if (normalized.replace(/\/$/, '') === ARCHIVE_STORAGE_PREFIX) {
      throw new Error('Refusing to delete the whole archive prefix')
    }
    let continuationToken: string | undefined
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: normalized.endsWith('/') ? normalized : `${normalized}/`,
          ContinuationToken: continuationToken,
          MaxKeys: DELETE_BATCH_SIZE
        })
      )
      const keys = (page.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key))
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.config.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true }
          })
        )
      }
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined
    } while (continuationToken)
  }

  async size(key: string) {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: assertArchiveKey(key)
        })
      )
      return head.ContentLength ?? null
    } catch (error) {
      if ((error as Error).name === 'NotFound') return null
      throw error
    }
  }

  async getDownloadUrl(key: string, { fileName }: { fileName: string }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: assertArchiveKey(key),
        ResponseContentType: 'application/zip',
        ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS }
    )
  }
}

export const createArchiveObjectStore = (
  storage: MediaStorageConfig | undefined | null
): ArchiveObjectStore | null => {
  switch (storage?.type) {
    case MediaStorageType.LocalFile:
      return new FileArchiveObjectStore(storage)
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage:
      return new S3ArchiveObjectStore(storage)
    default:
      return null
  }
}

/**
 * The store for the configured media storage, or null when none is configured
 * (an export has nowhere to live then).
 */
export const getArchiveObjectStore = (): ArchiveObjectStore | null =>
  createArchiveObjectStore(getConfig().mediaStorage)

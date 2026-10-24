import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'

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
const RESUMABLE_PART_SIZE = 8 * 1024 * 1024

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

/** What a resumable sink needs to be reopened by a later job slice. */
export type SinkState = Record<string, unknown>

/**
 * A file written in pieces across job slices. `checkpoint` makes everything
 * written so far durable and returns the state a later slice reopens it with;
 * bytes written after the last checkpoint are discarded when reopening.
 */
export interface ResumableSink {
  write(chunk: Buffer): Promise<void>
  checkpoint(): Promise<SinkState>
  /** Drops local resources; the file stays resumable from its checkpoint. */
  release(): Promise<void>
  /** Completes the file at its key; resolves with its size. */
  finish(): Promise<number>
  /** Throws the unfinished file away. */
  abort(): Promise<void>
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
  /** Opens `key` for a resumable write: a new file when `state` is null. */
  openResumableWrite(
    key: string,
    state: SinkState | null
  ): Promise<ResumableSink>
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

  async openResumableWrite(
    key: string,
    state: SinkState | null
  ): Promise<ResumableSink> {
    const target = this.resolve(key)
    const partial = `${target}.partial`
    await fs.mkdir(path.dirname(target), { recursive: true })
    const handle = await fs.open(partial, state ? 'r+' : 'w')
    let position = state ? Number(state.offset) : 0
    // Anything past the checkpoint belongs to a slice that did not finish.
    await handle.truncate(position)
    let open = true
    const close = async () => {
      if (!open) return
      open = false
      await handle.close()
    }
    return {
      async write(chunk) {
        let written = 0
        while (written < chunk.length) {
          const { bytesWritten } = await handle.write(
            chunk,
            written,
            chunk.length - written,
            position + written
          )
          written += bytesWritten
        }
        position += chunk.length
      },
      async checkpoint() {
        await handle.sync()
        return { offset: position }
      },
      release: close,
      async finish() {
        await handle.sync()
        await close()
        await fs.rename(partial, target)
        return position
      },
      async abort() {
        await close()
        await fs.rm(partial, { force: true })
      }
    }
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
    private readonly client: S3Client = createStorageS3Client(config),
    // S3 refuses parts under 5 MiB except the last one.
    private readonly partSize: number = RESUMABLE_PART_SIZE
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

  async openResumableWrite(
    key: string,
    state: SinkState | null
  ): Promise<ResumableSink> {
    assertArchiveKey(key)
    const tailKey = `${key}.tail`
    const bucket = this.config.bucket
    const client = this.client
    const partSize = this.partSize
    let uploadId: string
    let parts: { n: number; etag: string }[] = []
    let uploaded = 0
    let buffer: Buffer = Buffer.alloc(0)

    if (state) {
      uploadId = String(state.uploadId)
      parts = state.parts as { n: number; etag: string }[]
      uploaded = Number(state.uploaded)
      const tailBytes = Number(state.tailBytes)
      if (tailBytes > 0) {
        const tail = await this.get(tailKey)
        if (!tail || tail.length !== tailBytes) {
          throw new Error('The staged tail of the archive upload is missing')
        }
        buffer = tail
      }
    } else {
      const created = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: 'application/zip'
        })
      )
      if (!created.UploadId) throw new Error('The archive upload did not start')
      uploadId = created.UploadId
    }

    const uploadPart = async (body: Buffer, number: number) => {
      const result = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: number,
          Body: body
        })
      )
      if (!result.ETag) throw new Error('The archive part has no ETag')
      return result.ETag
    }

    return {
      async write(chunk) {
        buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
        while (buffer.length >= partSize) {
          const body = buffer.subarray(0, partSize)
          const number = parts.length + 1
          parts.push({ n: number, etag: await uploadPart(body, number) })
          uploaded += body.length
          buffer = buffer.subarray(partSize)
        }
      },
      async checkpoint() {
        // The bytes that do not fill a part yet go to a staged object, so a
        // later slice (possibly on another worker) picks them up.
        if (buffer.length > 0) {
          await client.send(
            new PutObjectCommand({ Bucket: bucket, Key: tailKey, Body: buffer })
          )
        }
        return {
          uploadId,
          parts: parts.map((part) => ({ ...part })),
          uploaded,
          tailBytes: buffer.length
        }
      },
      async release() {},
      async finish() {
        if (buffer.length > 0 || parts.length === 0) {
          const number = parts.length + 1
          parts.push({ n: number, etag: await uploadPart(buffer, number) })
          uploaded += buffer.length
          buffer = Buffer.alloc(0)
        }
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
              Parts: parts.map((part) => ({
                PartNumber: part.n,
                ETag: part.etag
              }))
            }
          })
        )
        await client
          .send(new DeleteObjectCommand({ Bucket: bucket, Key: tailKey }))
          .catch(() => undefined)
        return uploaded
      },
      async abort() {
        await client
          .send(
            new AbortMultipartUploadCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId
            })
          )
          .catch(() => undefined)
        await client
          .send(new DeleteObjectCommand({ Bucket: bucket, Key: tailKey }))
          .catch(() => undefined)
      }
    }
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

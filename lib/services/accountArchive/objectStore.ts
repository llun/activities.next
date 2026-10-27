import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomBytes } from 'crypto'
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
import { isTransientStorageError } from '@/lib/services/accountArchive/transientErrors'
import { assertStorageFilePath } from '@/lib/services/medias/storagePath'
import { createStorageS3Client } from '@/lib/services/storage/s3Client'
import { logger } from '@/lib/utils/logger'

import { ARCHIVE_STORAGE_PREFIX, IMPORT_STORAGE_PREFIX } from './constants'
import { toArchiveLoggableError } from './redact'

/** A short-lived link to the finished file on object storage. */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60
const DELETE_BATCH_SIZE = 1000
const RESUMABLE_PART_SIZE = 8 * 1024 * 1024
const RESUMABLE_PARTS_PER_STEP = 1000
/** The most parts S3 accepts in one multipart upload. */
const S3_MAX_PARTS = 10000
/**
 * Every S3 call of an export fails after this long, in total: the clients make
 * one attempt (no SDK retries, which would multiply it), and this is well under
 * the lease grace (`ARCHIVE_LEASE_GRACE_MS`), so a worker whose lease lapsed
 * cannot keep writing for long. A part must upload within it: parts of up to
 * 80 MiB need a few MB/s. On QStash the 30-second job is the tighter limit: a
 * slice may still send a part in flight and then the tail, about two parts in
 * 10 seconds, which is roughly 1.7 MB/s at 8 MiB parts.
 */
export const ARCHIVE_S3_REQUEST_TIMEOUT_MS = 30 * 1000

let warnedListParts = false
const warnListPartsOnce = (error: unknown) => {
  if (warnedListParts) return
  warnedListParts = true
  logger.warn({
    message: isNotImplemented(error)
      ? 'store does not support ListParts; completing with recorded ETags'
      : 'Listing the parts of an archive upload failed; completing it with the recorded part ETags. Allow s3:ListMultipartUploadParts to check them.',
    err: toArchiveLoggableError(error)
  })
}

/** A store that does not implement ListParts (501) is not a transient failure. */
const isNotImplemented = (error: unknown) => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === 'NotImplemented' || e?.$metadata?.httpStatusCode === 501
}

const KEY_PATTERN = new RegExp(
  `^(${ARCHIVE_STORAGE_PREFIX}|${IMPORT_STORAGE_PREFIX})(/[A-Za-z0-9._-]+)+$`
)
const PREFIX_PATTERN = new RegExp(
  `^(${ARCHIVE_STORAGE_PREFIX}|${IMPORT_STORAGE_PREFIX})(/[A-Za-z0-9._-]+)*/?$`
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

export interface ArchiveObjectMetadata {
  size: number
  etag: string | null
}

export interface ArchiveRangeReadOptions {
  /** Pins an S3 read to the object version recorded when an import started. */
  ifMatch?: string
  /** The full object size observed when the archive was opened. */
  expectedSize?: number
}

/**
 * A file written in pieces across job slices. `checkpoint` makes everything
 * written so far durable and returns the state a later slice reopens it with;
 * a later slice writes on from that state over whatever an unfinished slice
 * left past it (the same bytes), and `finish` cuts the file to its size. The
 * file is shared by the workers that resume from a saved state, so opening it
 * must not change it.
 */
export interface ResumableSink {
  write(chunk: Buffer): Promise<void>
  checkpoint(): Promise<SinkState>
  /**
   * Called once the state `checkpoint` returned has been saved: whatever an
   * older saved state needed (and this one does not) can go now. Until then it
   * must stay, because a save that never lands leaves the old state current.
   */
  committed(): Promise<void>
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
  /** Reads `key` from byte `start` (default 0) to the end. */
  openRead(key: string, start?: number): Promise<Readable | null>
  /** Opens `key` for a resumable write: a new file when `state` is null. */
  openResumableWrite(
    key: string,
    state: SinkState | null
  ): Promise<ResumableSink>
  /**
   * Throws away an unfinished file from its saved `state` alone: nothing is
   * downloaded, so it works when a staged tail is missing.
   */
  abortResumableWrite(key: string, state: SinkState): Promise<void>
  delete(key: string): Promise<void>
  /** Deletes every object under `prefix` (`archives/<id>/` for one export). */
  deletePrefix(prefix: string): Promise<void>
  /** Reads the object's current size and version marker, or null if missing. */
  getMetadata(key: string): Promise<ArchiveObjectMetadata | null>
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
  /**
   * Reads one byte range (both ends inclusive) without streaming the whole
   * object; null when the object does not exist.
   */
  readRange(
    key: string,
    start: number,
    endInclusive: number,
    options?: ArchiveRangeReadOptions
  ): Promise<Buffer | null>
  /**
   * A short-lived presigned PUT URL for an exact upload size when this store
   * supports it, or null when the caller must upload through the server.
   */
  getUploadUrl(
    key: string,
    size: number,
    expiresInSec: number
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

  async openRead(key: string, start = 0) {
    const target = this.resolve(key)
    try {
      await fs.access(target)
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
    return createReadStream(target, { start })
  }

  async abortResumableWrite(key: string, _state?: SinkState) {
    await fs.rm(`${this.resolve(key)}.partial`, { force: true })
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
    // The file is shared by every worker that resumes from a saved cursor, so
    // opening it must not change it: a worker that is slow to open could cut
    // what the one that took over has written. Writes go to the saved offset
    // and over whatever an unfinished slice left there (the same bytes, since
    // they are a function of the saved cursor); the file is cut to its final
    // size when it is finished.
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
      async committed() {},
      release: close,
      async finish() {
        await handle.truncate(position)
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

  async getMetadata(key: string): Promise<ArchiveObjectMetadata | null> {
    try {
      const stat = await fs.stat(this.resolve(key))
      return { size: stat.size, etag: null }
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async size(key: string) {
    return (await this.getMetadata(key))?.size ?? null
  }

  async getDownloadUrl() {
    return null
  }

  async readRange(
    key: string,
    start: number,
    endInclusive: number,
    _options?: ArchiveRangeReadOptions
  ): Promise<Buffer | null> {
    const target = this.resolve(key)
    try {
      await fs.access(target)
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
    const handle = await fs.open(target, 'r')
    try {
      const length = Math.max(0, endInclusive - start + 1)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, start)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  async getUploadUrl(
    _key: string,
    _size: number,
    _expiresInSec: number
  ): Promise<string | null> {
    // The local disk needs no presigned link: the caller uploads directly.
    return null
  }
}

export class S3ArchiveObjectStore implements ArchiveObjectStore {
  constructor(
    private readonly config: MediaStorageS3Config,
    private readonly client: S3Client = createStorageS3Client({
      ...config,
      requestTimeoutMs: ARCHIVE_S3_REQUEST_TIMEOUT_MS
    }),
    // S3 refuses parts under 5 MiB except the last one.
    private readonly partSize: number = RESUMABLE_PART_SIZE,
    // Parts grow by one `partSize` every `partsPerStep` parts, so an upload
    // reaches the 10,000-part limit of S3 only past hundreds of gigabytes.
    private readonly partsPerStep: number = RESUMABLE_PARTS_PER_STEP,
    private readonly maxParts: number = S3_MAX_PARTS
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
      const e = error as {
        name?: string
        $metadata?: { httpStatusCode?: number }
      }
      if (
        e?.name === 'NoSuchKey' ||
        e?.name === 'NotFound' ||
        e?.$metadata?.httpStatusCode === 404
      ) {
        return null
      }
      throw error
    }
  }

  async openRead(key: string, start = 0) {
    try {
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: assertArchiveKey(key),
          ...(start > 0 ? { Range: `bytes=${start}-` } : null)
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
    const bucket = this.config.bucket
    const client = this.client
    const { maxParts, partsPerStep } = this
    // Part n is as large as the number of its step times `partSize`; a pure
    // function of n, so a resumed upload cuts parts exactly as the first run.
    const partSizeOf = (number: number) =>
      this.partSize * (1 + Math.floor((number - 1) / partsPerStep))
    const assertPartNumber = (number: number) => {
      if (number > maxParts) {
        throw new Error(
          'The archive is too large to upload: it needs more than ' +
            `${maxParts} parts`
        )
      }
    }
    const tailPrefix = `${key}.tail-`
    // Each writer names its own tails. A checkpoint whose cursor save never
    // lands (a killed worker, or one that lost its lease) must not overwrite
    // the tail that the saved cursor refers to, and neither may a worker that
    // took over, so the name has the writer and the checkpoint in it.
    const writer = randomBytes(6).toString('hex')
    let sequence = 0
    let uploadId: string
    let parts: { n: number; etag: string }[] = []
    let uploaded = 0
    // Chunks wait in a list and are joined once per part, not on every write.
    let chunks: Buffer[] = []
    let buffered = 0
    const flatten = () => {
      if (chunks.length > 1) chunks = [Buffer.concat(chunks, buffered)]
      return chunks[0] ?? Buffer.alloc(0)
    }
    // The tail the saved state refers to, and the one a checkpoint just wrote.
    let savedTail: string | null = null
    let pendingTail: string | null = null

    if (state) {
      uploadId = String(state.uploadId)
      parts = state.parts as { n: number; etag: string }[]
      uploaded = Number(state.uploaded)
      const tailBytes = Number(state.tailBytes)
      if (tailBytes > 0) {
        savedTail = String(state.tail)
        if (!savedTail.startsWith(tailPrefix)) {
          throw new Error('The staged tail of the archive upload is invalid')
        }
        const tail = await this.get(savedTail)
        if (!tail || tail.length !== tailBytes) {
          throw new Error('The staged tail of the archive upload is missing')
        }
        chunks = [tail]
        buffered = tail.length
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

    const deleteTails = () => this.deleteTails(key)

    const listParts = async () => {
      const found: { n: number; etag: string; size: number }[] = []
      let marker: string | undefined
      for (;;) {
        const page = await client.send(
          new ListPartsCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker
          })
        )
        for (const part of page.Parts ?? []) {
          if (part.PartNumber === undefined || !part.ETag) continue
          found.push({
            n: part.PartNumber,
            etag: part.ETag,
            size: part.Size ?? -1
          })
        }
        if (!page.IsTruncated || page.NextPartNumberMarker === undefined) break
        // A provider that repeats the marker would loop for ever.
        if (
          marker !== undefined &&
          Number(page.NextPartNumberMarker) <= Number(marker)
        ) {
          throw new Error('The archive upload part listing does not advance')
        }
        marker = String(page.NextPartNumberMarker)
      }
      return found.sort((a, b) => a.n - b.n)
    }

    return {
      async write(chunk) {
        chunks.push(chunk)
        buffered += chunk.length
        while (buffered >= partSizeOf(parts.length + 1)) {
          const number = parts.length + 1
          assertPartNumber(number)
          const all = flatten()
          const body = all.subarray(0, partSizeOf(number))
          const rest = all.subarray(body.length)
          parts.push({ n: number, etag: await uploadPart(body, number) })
          uploaded += body.length
          chunks = rest.length > 0 ? [rest] : []
          buffered = rest.length
        }
      },
      async checkpoint() {
        // The bytes that do not fill a part yet go to a staged object, so a
        // later slice (possibly on another worker) picks them up.
        let tail: string | null = null
        if (buffered > 0) {
          sequence += 1
          tail = `${tailPrefix}${writer}-${sequence}`
          await client.send(
            new PutObjectCommand({ Bucket: bucket, Key: tail, Body: flatten() })
          )
        }
        pendingTail = tail
        return {
          uploadId,
          parts: parts.map((part) => ({ ...part })),
          uploaded,
          tailBytes: buffered,
          tail
        }
      },
      async committed() {
        // The cursor now refers to the new tail; the old one is garbage.
        const previous = savedTail
        savedTail = pendingTail
        if (previous && previous !== savedTail) {
          await client
            .send(new DeleteObjectCommand({ Bucket: bucket, Key: previous }))
            .catch(() => undefined)
        }
      },
      async release() {},
      async finish() {
        let lastSize = parts.length > 0 ? partSizeOf(parts.length) : 0
        if (buffered > 0 || parts.length === 0) {
          const number = parts.length + 1
          assertPartNumber(number)
          const last = flatten()
          parts.push({ n: number, etag: await uploadPart(last, number) })
          uploaded += last.length
          lastSize = last.length
          chunks = []
          buffered = 0
        }
        // The ETags come from the store when it will list them: a late
        // re-upload of a part with the same bytes (a stalled worker) replaces
        // the part and can change its ETag (SSE-KMS ETags are not digests). The
        // part count and sizes are still checked against what the cursor
        // counted. Listing needs a permission that nothing else needs
        // (s3:ListMultipartUploadParts); without it the cursor's ETags are used.
        let listed: { n: number; etag: string; size: number }[] | null = null
        try {
          listed = await listParts()
        } catch (error) {
          if (isTransientStorageError(error) && !isNotImplemented(error)) {
            throw error
          }
          warnListPartsOnce(error)
        }
        if (listed) {
          if (listed.length !== parts.length) {
            throw new Error(
              'The archive upload does not hold the expected parts'
            )
          }
          listed.forEach((found, index) => {
            const part = parts[index]
            const expected =
              index === parts.length - 1 ? lastSize : partSizeOf(part.n)
            if (found.n !== part.n || found.size !== expected) {
              throw new Error('A part of the archive upload has the wrong size')
            }
          })
        }
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
              Parts: parts.map((part, index) => ({
                PartNumber: part.n,
                ETag: listed ? listed[index].etag : part.etag
              }))
            }
          })
        )
        await deleteTails().catch(() => undefined)
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
        await deleteTails().catch(() => undefined)
      }
    }
  }

  async abortResumableWrite(key: string, state: SinkState) {
    assertArchiveKey(key)
    const bucket = this.config.bucket
    if (typeof state.uploadId === 'string') {
      await this.client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: state.uploadId
          })
        )
        .catch(() => undefined)
    }
    await this.deleteTails(key).catch(() => undefined)
  }

  private async deleteTails(key: string) {
    const listed = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: `${key}.tail-`
      })
    )
    for (const object of listed.Contents ?? []) {
      if (object.Key) {
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.config.bucket,
            Key: object.Key
          })
        )
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

  async getMetadata(key: string): Promise<ArchiveObjectMetadata | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: assertArchiveKey(key)
        })
      )
      if (head.ContentLength === undefined) return null
      if (!head.ETag) throw new Error('S3 archive object has no ETag')
      return { size: head.ContentLength, etag: head.ETag }
    } catch (error) {
      const e = error as {
        name?: string
        $metadata?: { httpStatusCode?: number }
      }
      if (
        e?.name === 'NotFound' ||
        e?.name === 'NoSuchKey' ||
        e?.$metadata?.httpStatusCode === 404
      ) {
        return null
      }
      throw error
    }
  }

  async size(key: string) {
    return (await this.getMetadata(key))?.size ?? null
  }

  async readRange(
    key: string,
    start: number,
    endInclusive: number,
    options?: ArchiveRangeReadOptions
  ): Promise<Buffer | null> {
    try {
      assertArchiveKey(key)
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: assertArchiveKey(key),
          Range: `bytes=${start}-${endInclusive}`,
          ...(options?.ifMatch ? { IfMatch: options.ifMatch } : null)
        })
      )
      if (options?.expectedSize !== undefined) {
        const totalSize = Number(
          /\/(\d+)$/.exec(object.ContentRange ?? '')?.[1]
        )
        if (
          !Number.isSafeInteger(totalSize) ||
          totalSize !== options.expectedSize
        ) {
          throw Object.assign(new Error('Archive object size changed'), {
            name: 'PreconditionFailed',
            $metadata: { httpStatusCode: 412 }
          })
        }
      }
      if (!object.Body) return null
      return Buffer.from(await object.Body.transformToByteArray())
    } catch (error) {
      const e = error as {
        name?: string
        $metadata?: { httpStatusCode?: number }
      }
      if (
        e?.name === 'NoSuchKey' ||
        e?.name === 'NotFound' ||
        e?.$metadata?.httpStatusCode === 404
      ) {
        return null
      }
      throw error
    }
  }

  /**
   * A presigned PUT for an exact browser upload size when it fits S3's
   * single-PUT limit. The signed content length makes S3 reject other sizes.
   */
  async getUploadUrl(
    key: string,
    size: number,
    expiresInSec: number
  ): Promise<string | null> {
    assertArchiveKey(key)
    if (size > 5 * 1024 * 1024 * 1024) return null
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: assertArchiveKey(key),
        ContentLength: size
      }),
      { expiresIn: expiresInSec }
    )
  }

  async getDownloadUrl(key: string, { fileName }: { fileName: string }) {
    // A media hostname means the bucket may be served publicly (a CDN or a
    // custom domain mapped to the whole bucket). A presigned URL names the key,
    // which holds the export's secret, and anyone with it could drop the
    // signature and fetch the file with no session for a week. So the download
    // is streamed through the owner-checked endpoint instead.
    if (this.config.hostname) return null
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

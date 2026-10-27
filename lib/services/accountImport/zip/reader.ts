import { PassThrough, Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import yauzl from 'yauzl'

import type { RandomAccessSource } from './source'

/** Why an archive was refused, or why one of its entries cannot be opened. */
export type ZipArchiveReason =
  | 'too_many_entries'
  | 'entry_too_large'
  | 'ratio_too_high'
  | 'total_too_large'
  | 'unsafe_name'
  | 'not_a_zip'

/** One entry of the catalog an open archive hands out. */
export interface ZipCatalogEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
}

export interface ZipArchive {
  /** Every entry that passed the caps, checked against the central directory. */
  readonly entries: readonly ZipCatalogEntry[]
  /** The decompressed stream of one entry, cut off at its declared size. */
  openEntryStream(name: string): Promise<Readable>
  close(): Promise<void>
}

/** The caps an open archive obeys. Callers may lower them, never raise them. */
export interface ZipOpenCaps {
  maxEntries: number
  maxEntrySize: number
  maxTotalUncompressed: number
  maxCompressionRatio: number
}

export const DEFAULT_ZIP_CAPS: Required<ZipOpenCaps> = {
  maxEntries: 200000,
  maxEntrySize: 2 * 1024 * 1024 * 1024,
  maxTotalUncompressed: 20 * 1024 * 1024 * 1024,
  maxCompressionRatio: 1000
}

/** A refused archive or entry, with the reason code the importer reports. */
export class ZipArchiveError extends Error {
  readonly reason: ZipArchiveReason

  constructor(reason: ZipArchiveReason, message: string) {
    super(message)
    this.name = 'ZipArchiveError'
    this.reason = reason
  }
}

const S_IFLNK = 0o120000
const S_IFDIR = 0o040000

/** A zip entry's POSIX file type, from the external attributes' high bits. */
const entryFileType = (entry: yauzl.Entry): number =>
  (entry.externalFileAttributes >>> 16) & 0o170000

/**
 * Only plain relative names are accepted. Refusing one name is a refusal of
 * the whole archive: an absolute path, a backslash, a NUL, a drive letter or
 * a `..` segment all mean the archive was not written by this server.
 */
const isSafeEntryName = (name: string): boolean => {
  if (name.length === 0) return false
  if (name.includes('\\') || name.includes('\0')) return false
  if (name.startsWith('/')) return false
  if (/^[A-Za-z]:/.test(name)) return false
  return name.split('/').every((segment) => segment !== '..')
}

const isDirectory = (entry: yauzl.Entry): boolean =>
  entry.fileName.endsWith('/') || (entryFileType(entry) & 0o170000) === S_IFDIR

const isSymlink = (entry: yauzl.Entry): boolean =>
  (entryFileType(entry) & 0o170000) === S_IFLNK

const checkEntryCaps = (entry: yauzl.Entry, limits: Required<ZipOpenCaps>) => {
  if (entry.uncompressedSize > limits.maxEntrySize) {
    throw new ZipArchiveError(
      'entry_too_large',
      `${entry.fileName} declares ${entry.uncompressedSize} uncompressed bytes`
    )
  }
  if (
    entry.uncompressedSize > 0 &&
    entry.compressedSize > 0 &&
    entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio
  ) {
    throw new ZipArchiveError(
      'ratio_too_high',
      `${entry.fileName} inflates to ${entry.uncompressedSize} bytes from ${entry.compressedSize} compressed`
    )
  }
}

/**
 * A Readable over the source, for one pull. yauzl's base `read` copies the
 * bytes it yields into the caller's buffer and asserts the byte count.
 */
const rangeReadable = (
  source: RandomAccessSource,
  start: number,
  endInclusive: number
): Readable => {
  let position = start
  return new Readable({
    read() {
      if (position > endInclusive) {
        this.push(null)
        return
      }
      const end = Math.min(position + RANGE_CHUNK - 1, endInclusive)
      source
        .read(position, end)
        .then((data) => {
          this.push(data)
        })
        .catch((error: unknown) => {
          this.destroy(
            error instanceof Error ? error : new Error(String(error))
          )
        })
      position = end + 1
    }
  })
}

/** How many bytes one pull of the range reader moves. */
const RANGE_CHUNK = 1024 * 1024
const READ_AHEAD_BLOCK_SIZE = 4 * 1024 * 1024
const MAX_CACHED_BLOCKS = 4
const MAX_CACHED_CENTRAL_DIRECTORY_SIZE = 64 * 1024 * 1024
const ZIP_EOCD_SIZE = 22
const ZIP_EOCD_MAX_COMMENT_SIZE = 0xffff
const ZIP64_EOCD_LOCATOR_SIZE = 20

interface CachedRange {
  start: number
  bytes: Buffer
}

interface CentralDirectoryInfo {
  entryCount: number
  offset: number
  size: number
}

interface EndRecordInfo {
  trailer: CachedRange | null
  centralDirectory: CentralDirectoryInfo | null
}

const safeNumberFromBigInt = (value: bigint): number | null =>
  value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null

/**
 * Reads the bounded end-record trailer once so the random-access reader can
 * reuse it, then extracts the central-directory range for a single prefetch.
 * Invalid or unsupported records are left for yauzl to reject itself.
 */
const readEndRecordInfo = async (
  source: RandomAccessSource
): Promise<EndRecordInfo> => {
  const trailerSize = Math.min(
    source.size,
    ZIP64_EOCD_LOCATOR_SIZE + ZIP_EOCD_SIZE + ZIP_EOCD_MAX_COMMENT_SIZE
  )
  if (trailerSize < ZIP_EOCD_SIZE) {
    return { trailer: null, centralDirectory: null }
  }

  const trailerStart = source.size - trailerSize
  const trailerBytes = await source.read(trailerStart, source.size - 1)
  if (trailerBytes.length !== trailerSize) {
    return { trailer: null, centralDirectory: null }
  }
  const trailer = { start: trailerStart, bytes: trailerBytes }

  for (
    let eocdOffset = trailerBytes.length - ZIP_EOCD_SIZE;
    eocdOffset >= 0;
    eocdOffset -= 1
  ) {
    if (trailerBytes.readUInt32LE(eocdOffset) !== 0x06054b50) continue
    const commentLength = trailerBytes.readUInt16LE(eocdOffset + 20)
    if (eocdOffset + ZIP_EOCD_SIZE + commentLength !== trailerBytes.length) {
      continue
    }

    let entryCount = trailerBytes.readUInt16LE(eocdOffset + 10)
    let offset = trailerBytes.readUInt32LE(eocdOffset + 16)
    let size = trailerBytes.readUInt32LE(eocdOffset + 12)
    const locatorOffset = eocdOffset - ZIP64_EOCD_LOCATOR_SIZE
    if (
      locatorOffset >= 0 &&
      trailerBytes.readUInt32LE(locatorOffset) === 0x07064b50
    ) {
      const zip64Offset = safeNumberFromBigInt(
        trailerBytes.readBigUInt64LE(locatorOffset + 8)
      )
      if (zip64Offset === null || zip64Offset + 56 > source.size) {
        return { trailer, centralDirectory: null }
      }
      const zip64End = await source.read(zip64Offset, zip64Offset + 55)
      if (zip64End.length !== 56 || zip64End.readUInt32LE(0) !== 0x06064b50) {
        return { trailer, centralDirectory: null }
      }
      const zip64EntryCount = safeNumberFromBigInt(zip64End.readBigUInt64LE(32))
      const zip64Size = safeNumberFromBigInt(zip64End.readBigUInt64LE(40))
      const zip64DirectoryOffset = safeNumberFromBigInt(
        zip64End.readBigUInt64LE(48)
      )
      if (
        zip64EntryCount === null ||
        zip64Size === null ||
        zip64DirectoryOffset === null
      ) {
        return {
          trailer,
          centralDirectory: {
            entryCount: Number.POSITIVE_INFINITY,
            offset: 0,
            size: 0
          }
        }
      }
      entryCount = zip64EntryCount
      size = zip64Size
      offset = zip64DirectoryOffset
    }

    if (
      entryCount === 0xffff ||
      size === 0xffffffff ||
      offset === 0xffffffff ||
      !Number.isSafeInteger(offset + size) ||
      offset + size > source.size
    ) {
      return { trailer, centralDirectory: null }
    }
    return { trailer, centralDirectory: { entryCount, offset, size } }
  }

  return { trailer, centralDirectory: null }
}

/**
 * Serves cached end-record and central-directory ranges, and reads local
 * headers through a small aligned LRU. This turns yauzl's two reads per
 * central-directory entry into one or a few large range requests.
 */
class ReadAheadSource implements RandomAccessSource {
  private centralDirectory: CachedRange | null = null
  private readonly blocks = new Map<number, Buffer>()

  constructor(
    private readonly source: RandomAccessSource,
    private readonly trailer: CachedRange | null
  ) {}

  async prefetchCentralDirectory({ offset, size }: CentralDirectoryInfo) {
    if (size === 0 || size > MAX_CACHED_CENTRAL_DIRECTORY_SIZE) return
    const bytes = await this.source.read(offset, offset + size - 1)
    if (bytes.length === size) this.centralDirectory = { start: offset, bytes }
  }

  get size() {
    return this.source.size
  }

  async read(start: number, endInclusive: number): Promise<Buffer> {
    if (endInclusive < start) return Buffer.alloc(0)
    if (start < 0 || endInclusive >= this.source.size) {
      throw new Error('ZIP range is outside the source')
    }

    for (const cached of [this.centralDirectory, this.trailer]) {
      if (
        cached &&
        start >= cached.start &&
        endInclusive < cached.start + cached.bytes.length
      ) {
        return cached.bytes.subarray(
          start - cached.start,
          endInclusive - cached.start + 1
        )
      }
    }
    return this.readFromBlocks(start, endInclusive)
  }

  private async readFromBlocks(
    start: number,
    endInclusive: number
  ): Promise<Buffer> {
    const chunks: Buffer[] = []
    let position = start
    while (position <= endInclusive) {
      const blockStart =
        Math.floor(position / READ_AHEAD_BLOCK_SIZE) * READ_AHEAD_BLOCK_SIZE
      let block = this.blocks.get(blockStart)
      if (!block) {
        const blockEnd = Math.min(
          blockStart + READ_AHEAD_BLOCK_SIZE,
          this.source.size
        )
        block = await this.source.read(blockStart, blockEnd - 1)
        if (block.length !== blockEnd - blockStart) {
          throw new Error('ZIP range read returned an incomplete block')
        }
      }
      this.blocks.delete(blockStart)
      this.blocks.set(blockStart, block)
      const chunkEnd = Math.min(endInclusive, blockStart + block.length - 1)
      chunks.push(
        block.subarray(position - blockStart, chunkEnd - blockStart + 1)
      )
      position = chunkEnd + 1
    }

    while (this.blocks.size > MAX_CACHED_BLOCKS) {
      const oldest = this.blocks.keys().next().value
      if (oldest === undefined) break
      this.blocks.delete(oldest)
    }
    return Buffer.concat(chunks, endInclusive - start + 1)
  }
}

class SourceRandomAccessReader extends yauzl.RandomAccessReader {
  constructor(private readonly source: ReadAheadSource) {
    super()
  }

  _readStreamForRange(start: number, end: number): Readable {
    return rangeReadable(this.source, start, end - 1)
  }
}

/**
 * Opens an archive held on a random-access source. The whole central
 * directory is read and checked against the caps before anything inflates.
 */
export const openZipArchive = async (
  source: RandomAccessSource,
  caps: Partial<ZipOpenCaps> = {}
): Promise<ZipArchive> => {
  const limits = { ...DEFAULT_ZIP_CAPS, ...caps }
  let reader: SourceRandomAccessReader
  let zipfile: yauzl.ZipFile
  try {
    const endRecordInfo = await readEndRecordInfo(source)
    if (
      endRecordInfo.centralDirectory &&
      endRecordInfo.centralDirectory.entryCount > limits.maxEntries
    ) {
      throw new ZipArchiveError(
        'too_many_entries',
        `archive holds ${endRecordInfo.centralDirectory.entryCount} entries`
      )
    }
    const readAheadSource = new ReadAheadSource(source, endRecordInfo.trailer)
    if (endRecordInfo.centralDirectory) {
      await readAheadSource.prefetchCentralDirectory(
        endRecordInfo.centralDirectory
      )
    }
    reader = new SourceRandomAccessReader(readAheadSource)
    zipfile = await yauzl.fromRandomAccessReaderPromise(reader, source.size, {
      lazyEntries: true,
      validateEntrySizes: true,
      autoClose: false
    })
  } catch (error) {
    if (error instanceof ZipArchiveError) throw error
    throw new ZipArchiveError(
      'not_a_zip',
      error instanceof Error ? error.message : 'unreadable archive'
    )
  }

  try {
    if (zipfile.entryCount > limits.maxEntries) {
      throw new ZipArchiveError(
        'too_many_entries',
        `archive holds ${zipfile.entryCount} entries`
      )
    }
    const catalog: ZipCatalogEntry[] = []
    const yauzlEntries = new Map<string, yauzl.Entry>()
    let totalUncompressed = 0
    for await (const entry of zipfile.eachEntry()) {
      if (!isSafeEntryName(entry.fileName)) {
        throw new ZipArchiveError(
          'unsafe_name',
          `entry name ${JSON.stringify(entry.fileName)} is not a safe relative path`
        )
      }
      if (isDirectory(entry)) continue
      if (isSymlink(entry)) continue
      checkEntryCaps(entry, limits)
      totalUncompressed += entry.uncompressedSize
      if (totalUncompressed > limits.maxTotalUncompressed) {
        throw new ZipArchiveError(
          'total_too_large',
          `entries add up to more than ${limits.maxTotalUncompressed} uncompressed bytes`
        )
      }
      catalog.push({
        name: entry.fileName,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
        compressionMethod: entry.compressionMethod
      })
      yauzlEntries.set(entry.fileName, entry)
    }

    return {
      entries: catalog,
      openEntryStream: async (entryName: string) => {
        const yauzlEntry = yauzlEntries.get(entryName)
        if (!yauzlEntry) {
          throw new ZipArchiveError(
            'not_a_zip',
            `no entry named ${JSON.stringify(entryName)}`
          )
        }
        const raw = await zipfile.openReadStreamPromise(yauzlEntry)
        return streamEntryWithErrors(raw, yauzlEntry)
      },
      close: async () => {
        await closeQuietly(zipfile)
      }
    }
  } catch (error) {
    await closeQuietly(zipfile)
    // yauzl's own name validation rejects an unsafe name before the catalog
    // loop sees it; map that to the same reason code the loop would use.
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('invalid characters in fileName') ||
      message.includes('invalid relative path') ||
      message.includes('absolute path')
    ) {
      throw new ZipArchiveError('unsafe_name', message)
    }
    if (message.includes('size mismatch')) {
      throw new ZipArchiveError('entry_too_large', message)
    }
    throw error
  }
}

/** Pipeline errors from yauzl's inflater and size validator to the consumer. */
const streamEntryWithErrors = (raw: Readable, entry: yauzl.Entry): Readable =>
  Readable.from(
    (async function* () {
      const output = new PassThrough()
      const completed = pipeline(raw, byteLimitTransform(entry), output)
      // The async iterator below receives and maps this failure from output.
      void completed.catch(() => undefined)
      try {
        for await (const chunk of output) yield chunk
      } catch (error) {
        if (error instanceof ZipArchiveError) throw error
        const message = error instanceof Error ? error.message : ''
        if (/too many bytes|byte count|size mismatch/i.test(message)) {
          throw new ZipArchiveError(
            'entry_too_large',
            'Entry data exceeds its declared size'
          )
        }
        throw new ZipArchiveError('not_a_zip', 'Entry data is invalid')
      }
    })(),
    { objectMode: false }
  )

/**
 * Errors once an entry's bytes pass its declared size, so a local header
 * that lies cannot keep the importer buffering past the central directory's
 * word.
 */
const byteLimitTransform = (entry: yauzl.Entry): Transform => {
  let seen = 0
  return new Transform({
    transform(chunk, _encoding, callback) {
      seen += chunk.length
      if (seen > entry.uncompressedSize) {
        callback(
          new ZipArchiveError(
            'entry_too_large',
            `${entry.fileName} decompressed to more than its declared ${entry.uncompressedSize} bytes`
          )
        )
        return
      }
      callback(null, chunk)
    }
  })
}

const closeQuietly = async (
  closeable: { close: () => void } | null | undefined
): Promise<void> => {
  if (!closeable) return
  try {
    closeable.close()
  } catch {
    // A refused or half-open archive must not keep its reader, but a failed
    // close of an already-dead handle is not worth reporting either.
  }
}

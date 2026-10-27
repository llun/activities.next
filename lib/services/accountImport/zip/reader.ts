import { Readable, Transform } from 'stream'

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
  entry.fileName.endsWith('/') ||
  (entryFileType(entry) & 0o170000) === S_IFDIR

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

class SourceRandomAccessReader extends yauzl.RandomAccessReader {
  constructor(private readonly source: RandomAccessSource) {
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
  const reader = new SourceRandomAccessReader(source)
  let zipfile: yauzl.ZipFile
  try {
    zipfile = await yauzl.fromRandomAccessReaderPromise(reader, source.size, {
      lazyEntries: true,
      validateEntrySizes: true,
      autoClose: false
    })
  } catch (error) {
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
        return raw.pipe(byteLimitTransform(yauzlEntry))
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

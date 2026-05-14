import fs from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import yauzl from 'yauzl'
import { createGunzip } from 'zlib'

import { DEFAULT_FITNESS_MAX_FILE_SIZE } from '@/lib/config/fitnessStorage'
import {
  StreamByteLimitError,
  readAsyncIterableToBufferWithLimit
} from '@/lib/utils/streamLimit'

type SupportedFitnessFileType = 'fit' | 'gpx' | 'tcx'

const SUPPORTED_FITNESS_ARCHIVE_EXTENSIONS = [
  '.fit',
  '.fit.gz',
  '.gpx',
  '.gpx.gz',
  '.tcx',
  '.tcx.gz'
]

const FITNESS_MIME_TYPES: Record<SupportedFitnessFileType, string> = {
  fit: 'application/vnd.ant.fit',
  gpx: 'application/gpx+xml',
  tcx: 'application/vnd.garmin.tcx+xml'
}

export const STRAVA_ARCHIVE_DEFAULT_LIMITS = {
  maxEntries: 20_000,
  maxEntryCompressedBytes: DEFAULT_FITNESS_MAX_FILE_SIZE,
  maxEntryUncompressedBytes: DEFAULT_FITNESS_MAX_FILE_SIZE,
  maxGzipOutputBytes: DEFAULT_FITNESS_MAX_FILE_SIZE,
  maxCsvRows: 100_000
}

export type StravaArchiveLimits = Partial<typeof STRAVA_ARCHIVE_DEFAULT_LIMITS>

export class StravaArchiveLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StravaArchiveLimitError'
  }
}

export interface StravaArchiveActivity {
  activityId: string
  activityName?: string
  activityDescription?: string
  fitnessFilePath: string
  mediaPaths: string[]
}

export interface StravaArchiveFitnessFilePayload {
  fileType: SupportedFitnessFileType
  fileName: string
  mimeType: string
  buffer: Buffer
}

const normalizeArchivePath = (value: string): string => {
  const normalized = value.replace(/\\/g, '/').trim()
  if (normalized.startsWith('./')) {
    return normalized.slice(2)
  }
  return normalized
}

const getArchiveLimits = (limits?: StravaArchiveLimits) => ({
  ...STRAVA_ARCHIVE_DEFAULT_LIMITS,
  ...limits
})

const assertSafeArchivePath = (value: string): string => {
  const normalized = normalizeArchivePath(value)
  const parts = normalized.split('/')
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    parts.includes('..')
  ) {
    throw new StravaArchiveLimitError(
      `Unsafe archive entry path: ${value || '(empty)'}`
    )
  }
  return normalized
}

const assertEntryWithinLimits = (
  entry: yauzl.Entry,
  limits: ReturnType<typeof getArchiveLimits>
) => {
  if (entry.fileName.endsWith('/')) {
    return
  }

  if (entry.compressedSize > limits.maxEntryCompressedBytes) {
    throw new StravaArchiveLimitError(
      `Archive entry ${entry.fileName} exceeds compressed size limit`
    )
  }

  if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
    throw new StravaArchiveLimitError(
      `Archive entry ${entry.fileName} exceeds uncompressed size limit`
    )
  }
}

const normalizeReferencedArchivePath = (value: string): string => {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .trim()
}

const openZipFile = async (filePath: string): Promise<yauzl.ZipFile> => {
  return new Promise((resolve, reject) => {
    // Keep the archive open after indexing entries; activity/media reads happen later.
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: false },
      (error, zipFile) => {
        if (error) {
          reject(error)
          return
        }
        if (!zipFile) {
          reject(new Error('Failed to open archive file'))
          return
        }
        resolve(zipFile)
      }
    )
  })
}

const indexZipEntries = async (
  zipFile: yauzl.ZipFile,
  limits: ReturnType<typeof getArchiveLimits>
): Promise<Map<string, yauzl.Entry>> => {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, yauzl.Entry>()
    let entryCount = 0
    let settled = false

    const cleanup = () => {
      zipFile.off('entry', onEntry)
      zipFile.off('end', onEnd)
      zipFile.off('error', onError)
    }

    const rejectAndClose = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      zipFile.close()
      reject(error)
    }

    const onEntry = (entry: yauzl.Entry) => {
      try {
        entryCount += 1
        if (entryCount > limits.maxEntries) {
          throw new StravaArchiveLimitError(
            `Strava archive exceeds entry limit of ${limits.maxEntries}`
          )
        }

        const normalizedPath = assertSafeArchivePath(entry.fileName)
        assertEntryWithinLimits(entry, limits)
        entries.set(normalizedPath, entry)
        zipFile.readEntry()
      } catch (error) {
        rejectAndClose(error)
      }
    }

    const onEnd = () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(entries)
    }

    const onError = (error: Error) => {
      rejectAndClose(error)
    }

    zipFile.on('entry', onEntry)
    zipFile.on('end', onEnd)
    zipFile.on('error', onError)
    zipFile.readEntry()
  })
}

const openZipEntryStream = async (
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry
): Promise<Readable> => {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error)
        return
      }
      if (!stream) {
        reject(new Error(`Failed to open archive entry ${entry.fileName}`))
        return
      }
      resolve(stream)
    })
  })
}

const readFileRange = async ({
  fd,
  buffer,
  position,
  label
}: {
  fd: Awaited<ReturnType<typeof fs.open>>
  buffer: Buffer
  position: number
  label: string
}) => {
  let offset = 0

  while (offset < buffer.byteLength) {
    const result = await fd.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      position + offset
    )
    if (result.bytesRead === 0) {
      break
    }
    offset += result.bytesRead
  }

  if (offset < buffer.byteLength) {
    throw new Error(
      `Short read on ${label}: expected ${buffer.byteLength}, got ${offset}`
    )
  }
}

// Read a ZIP entry that uses Stored (no compression) directly via fs.read,
// bypassing yauzl's openReadStream which can hang on Stored entries in large
// archives due to an fd-slicer read-queue issue.
const readStoredEntryDirectly = async (
  zipFilePath: string,
  entry: yauzl.Entry,
  limits: ReturnType<typeof getArchiveLimits>
): Promise<Buffer> => {
  assertEntryWithinLimits(entry, limits)
  // Local file header layout (PKWARE spec section 4.3.7):
  //   signature         4 bytes
  //   version needed    2 bytes
  //   general flags     2 bytes
  //   compression       2 bytes
  //   mod time          2 bytes
  //   mod date          2 bytes
  //   crc-32            4 bytes
  //   compressed size   4 bytes
  //   uncompressed size 4 bytes
  //   filename length   2 bytes  (offset 26)
  //   extra field len   2 bytes  (offset 28)
  //   = 30 bytes fixed header
  const fd = await fs.open(zipFilePath, 'r')
  try {
    const headerBuf = Buffer.allocUnsafe(30)
    await readFileRange({
      fd,
      buffer: headerBuf,
      position: entry.relativeOffsetOfLocalHeader,
      label: `local file header for ${entry.fileName}`
    })
    const fileNameLength = headerBuf.readUInt16LE(26)
    const extraFieldLength = headerBuf.readUInt16LE(28)
    const dataOffset =
      entry.relativeOffsetOfLocalHeader + 30 + fileNameLength + extraFieldLength
    const dataBuf = Buffer.allocUnsafe(entry.compressedSize)
    await readFileRange({
      fd,
      buffer: dataBuf,
      position: dataOffset,
      label: `entry data for ${entry.fileName}`
    })
    return dataBuf
  } finally {
    await fd.close()
  }
}

export const parseStravaArchiveCsvRows = (
  csvText: string,
  options: { maxRows?: number } = {}
): string[][] => {
  const maxRows = options.maxRows ?? STRAVA_ARCHIVE_DEFAULT_LIMITS.maxCsvRows
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const pushRow = () => {
    rows.push(row)
    if (rows.length > maxRows) {
      throw new StravaArchiveLimitError(
        `activities.csv exceeds CSV row limit of ${maxRows}`
      )
    }
  }

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index]

    if (inQuotes) {
      if (character === '"') {
        if (csvText[index + 1] === '"') {
          field += '"'
          index += 1
          continue
        }
        inQuotes = false
        continue
      }

      field += character
      continue
    }

    if (character === '"') {
      inQuotes = true
      continue
    }

    if (character === ',') {
      row.push(field)
      field = ''
      continue
    }

    if (character === '\n') {
      row.push(field)
      pushRow()
      row = []
      field = ''
      continue
    }

    if (character !== '\r') {
      field += character
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    pushRow()
  }

  return rows
}

const getMediaPaths = (value: string): string[] => {
  if (!value) {
    return []
  }
  return value
    .split('|')
    .map((item) => normalizeReferencedArchivePath(item))
    .filter((item) => item.length > 0)
}

const isSupportedFitnessPath = (fitnessFilePath: string): boolean => {
  const lowerCasePath = fitnessFilePath.toLowerCase()
  return SUPPORTED_FITNESS_ARCHIVE_EXTENSIONS.some((extension) =>
    lowerCasePath.endsWith(extension)
  )
}

const getFitnessFileTypeFromPath = (
  fitnessFilePath: string
): SupportedFitnessFileType | null => {
  const normalizedPath = fitnessFilePath.toLowerCase()
  if (normalizedPath.endsWith('.fit') || normalizedPath.endsWith('.fit.gz')) {
    return 'fit'
  }
  if (normalizedPath.endsWith('.gpx') || normalizedPath.endsWith('.gpx.gz')) {
    return 'gpx'
  }
  if (normalizedPath.endsWith('.tcx') || normalizedPath.endsWith('.tcx.gz')) {
    return 'tcx'
  }
  return null
}

const shouldGunzipFitnessBuffer = (fitnessFilePath: string): boolean =>
  fitnessFilePath.toLowerCase().endsWith('.gz')

export const getArchiveMediaMimeType = (
  mediaPath: string
): string | undefined => {
  const extension = path.extname(mediaPath).toLowerCase()
  switch (extension) {
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.mov':
      return 'video/quicktime'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    default:
      return undefined
  }
}

export const toStravaArchiveFitnessFilePayload = async (
  {
    fitnessFilePath,
    buffer
  }: {
    fitnessFilePath: string
    buffer: Buffer
  },
  options: { maxGzipOutputBytes?: number } = {}
): Promise<StravaArchiveFitnessFilePayload> => {
  const fileType = getFitnessFileTypeFromPath(fitnessFilePath)
  if (!fileType) {
    throw new Error(`Unsupported fitness file path: ${fitnessFilePath}`)
  }

  const maxGzipOutputBytes =
    options.maxGzipOutputBytes ??
    STRAVA_ARCHIVE_DEFAULT_LIMITS.maxGzipOutputBytes

  const fitnessBuffer = shouldGunzipFitnessBuffer(fitnessFilePath)
    ? await readAsyncIterableToBufferWithLimit(
        Readable.from(buffer).pipe(createGunzip()),
        maxGzipOutputBytes,
        'Fitness gzip output'
      ).catch((error) => {
        if (error instanceof StreamByteLimitError) {
          throw new StravaArchiveLimitError(
            `Fitness file ${fitnessFilePath} exceeds gzip output limit`
          )
        }
        throw error
      })
    : buffer

  const baseName = path.basename(fitnessFilePath)
  const fileName = baseName.toLowerCase().endsWith('.gz')
    ? baseName.slice(0, -3)
    : baseName

  return {
    fileType,
    fileName,
    mimeType: FITNESS_MIME_TYPES[fileType],
    buffer: fitnessBuffer
  }
}

export class StravaArchiveReader {
  private _filePath: string
  private _zipFile: yauzl.ZipFile
  private _entriesByPath: Map<string, yauzl.Entry>
  private _limits: ReturnType<typeof getArchiveLimits>

  private constructor({
    filePath,
    zipFile,
    entriesByPath,
    limits
  }: {
    filePath: string
    zipFile: yauzl.ZipFile
    entriesByPath: Map<string, yauzl.Entry>
    limits: ReturnType<typeof getArchiveLimits>
  }) {
    this._filePath = filePath
    this._zipFile = zipFile
    this._entriesByPath = entriesByPath
    this._limits = limits
  }

  static async open(
    filePath: string,
    options: { limits?: StravaArchiveLimits } = {}
  ): Promise<StravaArchiveReader> {
    const limits = getArchiveLimits(options.limits)
    const zipFile = await openZipFile(filePath)
    const entriesByPath = await indexZipEntries(zipFile, limits)
    return new StravaArchiveReader({
      filePath,
      zipFile,
      entriesByPath,
      limits
    })
  }

  close(): void {
    this._zipFile.close()
  }

  async readEntryBuffer(entryPath: string): Promise<Buffer | null> {
    const normalizedPath = normalizeReferencedArchivePath(entryPath)
    const entry = this._entriesByPath.get(normalizedPath)
    if (!entry || entry.fileName.endsWith('/')) {
      return null
    }
    assertEntryWithinLimits(entry, this._limits)

    // Stored entries (compressionMethod=0) can hang in yauzl's openReadStream
    // due to an fd-slicer read-queue issue in large archives.  Read them
    // directly via fs.read to bypass the problem entirely.
    if (entry.compressionMethod === 0) {
      return readStoredEntryDirectly(this._filePath, entry, this._limits)
    }

    const entryStream = await openZipEntryStream(this._zipFile, entry)
    return readAsyncIterableToBufferWithLimit(
      entryStream,
      this._limits.maxEntryUncompressedBytes,
      `Archive entry ${entry.fileName}`
    )
  }

  hasEntry(entryPath: string): boolean {
    return this._entriesByPath.has(normalizeReferencedArchivePath(entryPath))
  }

  async getActivities(): Promise<StravaArchiveActivity[]> {
    const csvBuffer = await this.readEntryBuffer('activities.csv')
    if (!csvBuffer) {
      throw new Error('Strava archive does not contain activities.csv')
    }

    const rows = parseStravaArchiveCsvRows(csvBuffer.toString('utf8'), {
      maxRows: this._limits.maxCsvRows
    })
    if (rows.length === 0) {
      return []
    }

    const header = [...rows[0]]
    header[0] = header[0].replace(/^\uFEFF/, '')

    const filenameIndex = header.findIndex((column) => column === 'Filename')
    if (filenameIndex < 0) {
      throw new Error(
        'Strava archive activities.csv is missing Filename column'
      )
    }

    const activityIdIndex = header.findIndex(
      (column) => column === 'Activity ID'
    )
    const activityNameIndex = header.findIndex(
      (column) => column === 'Activity Name'
    )
    const activityDescriptionIndex = header.findIndex(
      (column) => column === 'Activity Description'
    )
    const mediaIndex = header.findIndex((column) => column === 'Media')

    const activities: StravaArchiveActivity[] = []
    for (const row of rows.slice(1)) {
      const rawFitnessPath = row[filenameIndex] ?? ''
      const fitnessFilePath = normalizeArchivePath(rawFitnessPath)
      if (!fitnessFilePath || !isSupportedFitnessPath(fitnessFilePath)) {
        continue
      }

      const activityId =
        (activityIdIndex >= 0 ? row[activityIdIndex] : undefined)?.trim() ||
        path.basename(fitnessFilePath)

      const activityName =
        activityNameIndex >= 0
          ? row[activityNameIndex]?.trim() || undefined
          : undefined
      const activityDescription =
        activityDescriptionIndex >= 0
          ? row[activityDescriptionIndex]?.trim() || undefined
          : undefined
      const mediaPaths =
        mediaIndex >= 0 ? getMediaPaths(row[mediaIndex] ?? '') : []

      activities.push({
        activityId,
        activityName,
        activityDescription,
        fitnessFilePath,
        mediaPaths
      })
    }

    return activities
  }
}

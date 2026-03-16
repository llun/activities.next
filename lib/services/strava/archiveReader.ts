import fs from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import yauzl from 'yauzl'
import { gunzipSync } from 'zlib'

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
  zipFile: yauzl.ZipFile
): Promise<Map<string, yauzl.Entry>> => {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, yauzl.Entry>()

    const cleanup = () => {
      zipFile.off('entry', onEntry)
      zipFile.off('end', onEnd)
      zipFile.off('error', onError)
    }

    const onEntry = (entry: yauzl.Entry) => {
      entries.set(normalizeArchivePath(entry.fileName), entry)
      zipFile.readEntry()
    }

    const onEnd = () => {
      cleanup()
      resolve(entries)
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
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

const readStreamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

// Read a ZIP entry that uses Stored (no compression) directly via fs.read,
// bypassing yauzl's openReadStream which can hang on Stored entries in large
// archives due to an fd-slicer read-queue issue.
const readStoredEntryDirectly = async (
  zipFilePath: string,
  entry: yauzl.Entry
): Promise<Buffer> => {
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
    const headerResult = await fd.read(
      headerBuf,
      0,
      30,
      entry.relativeOffsetOfLocalHeader
    )
    if (headerResult.bytesRead < 30) {
      throw new Error(
        `Short read on local file header for ${entry.fileName}: expected 30, got ${headerResult.bytesRead}`
      )
    }
    const fileNameLength = headerBuf.readUInt16LE(26)
    const extraFieldLength = headerBuf.readUInt16LE(28)
    const dataOffset =
      entry.relativeOffsetOfLocalHeader + 30 + fileNameLength + extraFieldLength
    const dataBuf = Buffer.allocUnsafe(entry.compressedSize)
    const dataResult = await fd.read(
      dataBuf,
      0,
      entry.compressedSize,
      dataOffset
    )
    if (dataResult.bytesRead < entry.compressedSize) {
      throw new Error(
        `Short read on entry data for ${entry.fileName}: expected ${entry.compressedSize}, got ${dataResult.bytesRead}`
      )
    }
    return dataBuf
  } finally {
    await fd.close()
  }
}

const parseCsvRows = (csvText: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

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
      rows.push(row)
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
    rows.push(row)
  }

  return rows
}

const getMediaPaths = (value: string): string[] => {
  if (!value) {
    return []
  }
  return value
    .split('|')
    .map((item) => normalizeArchivePath(item))
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

export const toStravaArchiveFitnessFilePayload = ({
  fitnessFilePath,
  buffer
}: {
  fitnessFilePath: string
  buffer: Buffer
}): StravaArchiveFitnessFilePayload => {
  const fileType = getFitnessFileTypeFromPath(fitnessFilePath)
  if (!fileType) {
    throw new Error(`Unsupported fitness file path: ${fitnessFilePath}`)
  }

  const fitnessBuffer = shouldGunzipFitnessBuffer(fitnessFilePath)
    ? gunzipSync(buffer)
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

  private constructor({
    filePath,
    zipFile,
    entriesByPath
  }: {
    filePath: string
    zipFile: yauzl.ZipFile
    entriesByPath: Map<string, yauzl.Entry>
  }) {
    this._filePath = filePath
    this._zipFile = zipFile
    this._entriesByPath = entriesByPath
  }

  static async open(filePath: string): Promise<StravaArchiveReader> {
    const zipFile = await openZipFile(filePath)
    const entriesByPath = await indexZipEntries(zipFile)
    return new StravaArchiveReader({
      filePath,
      zipFile,
      entriesByPath
    })
  }

  close(): void {
    this._zipFile.close()
  }

  async readEntryBuffer(entryPath: string): Promise<Buffer | null> {
    const normalizedPath = normalizeArchivePath(entryPath)
    const entry = this._entriesByPath.get(normalizedPath)
    if (!entry || entry.fileName.endsWith('/')) {
      return null
    }

    // Stored entries (compressionMethod=0) can hang in yauzl's openReadStream
    // due to an fd-slicer read-queue issue in large archives.  Read them
    // directly via fs.read to bypass the problem entirely.
    if (entry.compressionMethod === 0) {
      return readStoredEntryDirectly(this._filePath, entry)
    }

    const entryStream = await openZipEntryStream(this._zipFile, entry)
    return readStreamToBuffer(entryStream)
  }

  hasEntry(entryPath: string): boolean {
    return this._entriesByPath.has(normalizeArchivePath(entryPath))
  }

  async getActivities(): Promise<StravaArchiveActivity[]> {
    const csvBuffer = await this.readEntryBuffer('activities.csv')
    if (!csvBuffer) {
      throw new Error('Strava archive does not contain activities.csv')
    }

    const rows = parseCsvRows(csvBuffer.toString('utf8'))
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

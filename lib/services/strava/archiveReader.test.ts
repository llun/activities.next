import { randomUUID } from 'crypto'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { crc32, gzipSync } from 'zlib'

import {
  StravaArchiveLimits,
  StravaArchiveReader,
  getArchiveMediaMimeType,
  parseStravaArchiveCsvRows,
  toStravaArchiveFitnessFilePayload
} from '@/lib/services/strava/archiveReader'

/**
 * Writes a minimal, valid ZIP whose entries all use the Stored (uncompressed)
 * method — the same shape a Strava export uses for its CSVs, and the path
 * `readEntryBuffer` reads directly through `fs.read` rather than yauzl.
 *
 * Hand-built because the repo has no ZIP writer: `yauzl` only reads.
 */
const buildStoredZip = (
  files: Array<{ name: string; content: string | Buffer }>
): Buffer => {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8')
    const content = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, 'utf8')
    const checksum = crc32(content)

    // Local file header, PKWARE spec 4.3.7.
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    // 1980-01-01, the earliest date the DOS format can express.
    localHeader.writeUInt16LE(0x21, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(content.byteLength, 18)
    localHeader.writeUInt32LE(content.byteLength, 22)
    localHeader.writeUInt16LE(nameBytes.byteLength, 26)
    localHeader.writeUInt16LE(0, 28)

    // Central directory header, PKWARE spec 4.3.12.
    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0x21, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(content.byteLength, 20)
    centralHeader.writeUInt32LE(content.byteLength, 24)
    centralHeader.writeUInt16LE(nameBytes.byteLength, 28)
    centralHeader.writeUInt32LE(0, 30)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(localOffset, 42)

    localParts.push(localHeader, nameBytes, content)
    centralParts.push(centralHeader, nameBytes)
    localOffset +=
      localHeader.byteLength + nameBytes.byteLength + content.byteLength
  }

  const centralDirectory = Buffer.concat(centralParts)
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(0, 4)
  endOfCentralDirectory.writeUInt16LE(0, 6)
  endOfCentralDirectory.writeUInt16LE(files.length, 8)
  endOfCentralDirectory.writeUInt16LE(files.length, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.byteLength, 12)
  endOfCentralDirectory.writeUInt32LE(localOffset, 16)
  endOfCentralDirectory.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory])
}

describe('archiveReader helpers', () => {
  describe('getArchiveMediaMimeType', () => {
    it('returns supported media MIME types', () => {
      expect(getArchiveMediaMimeType('media/photo.jpg')).toBe('image/jpeg')
      expect(getArchiveMediaMimeType('media/photo.jpeg')).toBe('image/jpeg')
      expect(getArchiveMediaMimeType('media/photo.png')).toBe('image/png')
      expect(getArchiveMediaMimeType('media/video.mp4')).toBe('video/mp4')
      expect(getArchiveMediaMimeType('media/video.mov')).toBe('video/quicktime')
      expect(getArchiveMediaMimeType('media/video.webm')).toBe('video/webm')
    })

    it('returns undefined for unsupported media types', () => {
      expect(getArchiveMediaMimeType('media/clip.heic')).toBeUndefined()
      expect(getArchiveMediaMimeType('media/clip.gif')).toBeUndefined()
    })
  })

  describe('toStravaArchiveFitnessFilePayload', () => {
    it('builds payload for uncompressed fitness file', async () => {
      const payload = await toStravaArchiveFitnessFilePayload({
        fitnessFilePath: 'activities/123.gpx',
        buffer: Buffer.from('<gpx />')
      })

      expect(payload.fileType).toBe('gpx')
      expect(payload.fileName).toBe('123.gpx')
      expect(payload.mimeType).toBe('application/gpx+xml')
      expect(payload.buffer.toString()).toBe('<gpx />')
    })

    it('gunzips compressed fitness file payloads', async () => {
      const payload = await toStravaArchiveFitnessFilePayload({
        fitnessFilePath: 'activities/123.fit.gz',
        buffer: gzipSync(Buffer.from('fit-binary'))
      })

      expect(payload.fileType).toBe('fit')
      expect(payload.fileName).toBe('123.fit')
      expect(payload.mimeType).toBe('application/vnd.ant.fit')
      expect(payload.buffer.toString()).toBe('fit-binary')
    })

    it('throws for unsupported fitness files', async () => {
      await expect(
        Promise.resolve().then(() =>
          toStravaArchiveFitnessFilePayload({
            fitnessFilePath: 'activities/123.csv',
            buffer: Buffer.from('bad')
          })
        )
      ).rejects.toThrow('Unsupported fitness file path')
    })

    it('rejects gzip output that exceeds the configured limit', async () => {
      await expect(
        toStravaArchiveFitnessFilePayload(
          {
            fitnessFilePath: 'activities/123.fit.gz',
            buffer: gzipSync(Buffer.from('oversized-gzip-output'))
          },
          { maxGzipOutputBytes: 4 }
        )
      ).rejects.toThrow('exceeds gzip output limit')
    })
  })

  describe('parseStravaArchiveCsvRows', () => {
    it('rejects CSV row-count overflow without allocating millions of rows', () => {
      const csv = ['Filename', 'activities/1.fit', 'activities/2.fit'].join(
        '\n'
      )

      expect(() => parseStravaArchiveCsvRows(csv, { maxRows: 2 })).toThrow(
        'exceeds CSV row limit'
      )
    })
  })
})

describe('StravaArchiveReader', () => {
  let archiveDirectory: string
  const openReaders: StravaArchiveReader[] = []

  beforeAll(async () => {
    archiveDirectory = await mkdtemp(join(tmpdir(), 'strava-archive-test-'))
  })

  afterEach(() => {
    // The reader keeps the zip open on purpose (activity and media reads happen
    // long after indexing), so every test has to hand its file descriptor back.
    for (const reader of openReaders.splice(0)) {
      reader.close()
    }
  })

  afterAll(async () => {
    await rm(archiveDirectory, { recursive: true, force: true })
  })

  const openArchive = async (
    files: Array<{ name: string; content: string | Buffer }>,
    limits?: StravaArchiveLimits
  ): Promise<StravaArchiveReader> => {
    const filePath = join(archiveDirectory, `${randomUUID()}.zip`)
    await writeFile(filePath, buildStoredZip(files))
    const reader = await StravaArchiveReader.open(filePath, { limits })
    openReaders.push(reader)
    return reader
  }

  describe('getActivities', () => {
    it('reads the activity rows out of activities.csv', async () => {
      const reader = await openArchive([
        {
          name: 'activities.csv',
          content: [
            'Activity ID,Activity Name,Activity Description,Filename,Media',
            '1001,Morning ride,Felt good,activities/1001.gpx,media/photo-1.jpg',
            '1002,Evening run,,activities/1002.tcx,'
          ].join('\n')
        }
      ])

      const activities = await reader.getActivities()

      expect(activities).toEqual([
        {
          activityId: '1001',
          activityName: 'Morning ride',
          activityDescription: 'Felt good',
          fitnessFilePath: 'activities/1001.gpx',
          mediaPaths: ['media/photo-1.jpg']
        },
        {
          activityId: '1002',
          activityName: 'Evening run',
          // An empty cell is "absent", not an empty description.
          activityDescription: undefined,
          fitnessFilePath: 'activities/1002.tcx',
          mediaPaths: []
        }
      ])
    })

    it('skips rows whose file is not a supported fitness file', async () => {
      const reader = await openArchive([
        {
          name: 'activities.csv',
          content: [
            'Activity ID,Activity Name,Filename',
            '1001,Morning ride,activities/1001.gpx',
            '1002,Manual entry,'
          ].join('\n')
        }
      ])

      const activities = await reader.getActivities()

      expect(activities).toHaveLength(1)
      expect(activities[0].activityId).toBe('1001')
    })
  })

  describe('open limits', () => {
    it('refuses to open an archive whose CSV entry exceeds the entry limit', async () => {
      const filePath = join(archiveDirectory, `${randomUUID()}.zip`)
      await writeFile(
        filePath,
        buildStoredZip([
          {
            name: 'activities.csv',
            content: 'Activity ID,Filename\n'.repeat(64)
          }
        ])
      )

      // Size limits are enforced while indexing, so an oversized entry fails
      // the whole archive rather than surfacing on the read that needs it.
      await expect(
        StravaArchiveReader.open(filePath, {
          limits: { maxEntryUncompressedBytes: 16 }
        })
      ).rejects.toThrow('exceeds uncompressed size limit')
    })
  })
})

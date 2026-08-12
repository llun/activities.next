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
  parseStravaGearCsvRows,
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

  describe('parseStravaGearCsvRows', () => {
    it('reads the named gear out of a bikes export', () => {
      const csv = [
        'Bike ID,Bike Name,Bike Brand',
        'b1234567,Moots Routt 45,Moots',
        'b7654321,Winter bike,Surly'
      ].join('\n')

      expect(parseStravaGearCsvRows(csv, 'bike')).toEqual([
        { name: 'Moots Routt 45', kind: 'bike' },
        { name: 'Winter bike', kind: 'bike' }
      ])
    })

    it('takes the kind from the caller, never from the CSV', () => {
      // The same rows read as `shoes` when they came out of shoes.csv — the
      // file decides, so a renamed or translated column cannot mis-file gear.
      const csv = ['Bike ID,Bike Name', 'b1234567,Moots Routt 45'].join('\n')

      expect(parseStravaGearCsvRows(csv, 'shoes')).toEqual([
        { name: 'Moots Routt 45', kind: 'shoes' }
      ])
    })

    it('falls back to the first column when no header mentions a name', () => {
      const csv = ['Gear,Marque', 'Moots Routt 45,Moots'].join('\n')

      expect(parseStravaGearCsvRows(csv, 'bike')).toEqual([
        { name: 'Moots Routt 45', kind: 'bike' }
      ])
    })

    it('strips the byte-order mark from the first header', () => {
      const csv = ['﻿Name,Brand', 'Nimbus 25,Hoka'].join('\n')

      expect(parseStravaGearCsvRows(csv, 'shoes')).toEqual([
        { name: 'Nimbus 25', kind: 'shoes' }
      ])
    })

    it('drops empty names and collapses duplicates', () => {
      const csv = [
        'Bike ID,Bike Name',
        'b1,Moots Routt 45',
        'b2,',
        'b3,  moots routt 45  '
      ].join('\n')

      expect(parseStravaGearCsvRows(csv, 'bike')).toEqual([
        { name: 'Moots Routt 45', kind: 'bike' }
      ])
    })

    it('returns no gear for an empty file', () => {
      expect(parseStravaGearCsvRows('', 'bike')).toEqual([])
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
    it('reads the gear name out of the Activity Gear column', async () => {
      const reader = await openArchive([
        {
          name: 'activities.csv',
          content: [
            'Activity ID,Activity Name,Activity Gear,Filename,Media',
            '1001,Morning ride,Moots Routt 45,activities/1001.gpx,',
            '1002,Evening run,  Nimbus 25  ,activities/1002.tcx,',
            '1003,No gear ride,,activities/1003.fit,'
          ].join('\n')
        }
      ])

      const activities = await reader.getActivities()

      expect(activities).toHaveLength(3)
      expect(activities[0].activityGear).toBe('Moots Routt 45')
      // Trimmed, because the name is the archive importer's lookup key.
      expect(activities[1].activityGear).toBe('Nimbus 25')
      // An empty cell is "no gear", not a gear named ''.
      expect(activities[2].activityGear).toBeUndefined()
    })

    it('leaves the gear unset when the export has no Activity Gear column', async () => {
      const reader = await openArchive([
        {
          name: 'activities.csv',
          content: [
            'Activity ID,Activity Name,Filename',
            '1001,Morning ride,activities/1001.gpx'
          ].join('\n')
        }
      ])

      const activities = await reader.getActivities()

      expect(activities).toHaveLength(1)
      expect(activities[0].activityGear).toBeUndefined()
    })
  })

  describe('getGear', () => {
    const bikesCsv = [
      'Bike ID,Bike Name,Bike Brand',
      'b1234567,Moots Routt 45,Moots'
    ].join('\n')
    const shoesCsv = ['Shoe ID,Shoe Name', 'g7654321,Nimbus 25'].join('\n')

    it('reads both gear files, taking the kind from the file', async () => {
      const reader = await openArchive([
        { name: 'bikes.csv', content: bikesCsv },
        { name: 'shoes.csv', content: shoesCsv }
      ])

      await expect(reader.getGear()).resolves.toEqual([
        { name: 'Moots Routt 45', kind: 'bike' },
        { name: 'Nimbus 25', kind: 'shoes' }
      ])
    })

    // Both files are optional — older exports predate them, and an athlete with
    // no shoes has no shoes.csv. A missing one yields no gear, never an error:
    // the importer falls back to the name each activity carries.
    it.each([
      {
        description: 'bikes.csv is missing',
        files: [{ name: 'shoes.csv', content: shoesCsv }],
        expected: [{ name: 'Nimbus 25', kind: 'shoes' }]
      },
      {
        description: 'shoes.csv is missing',
        files: [{ name: 'bikes.csv', content: bikesCsv }],
        expected: [{ name: 'Moots Routt 45', kind: 'bike' }]
      },
      {
        description: 'both are missing',
        files: [{ name: 'activities.csv', content: 'Filename\n' }],
        expected: []
      }
    ])('returns what it can when $description', async ({ files, expected }) => {
      const reader = await openArchive(files)

      await expect(reader.getGear()).resolves.toEqual(expected)
    })

    it('degrades rather than throwing on a gear file that is not CSV', async () => {
      const reader = await openArchive([
        {
          name: 'bikes.csv',
          content: Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x02])
        },
        { name: 'shoes.csv', content: shoesCsv }
      ])

      // The binary blob has no newline, so it is a header row and nothing else
      // — no gear, and crucially no throw that would fail the whole import.
      await expect(reader.getGear()).resolves.toEqual([
        { name: 'Nimbus 25', kind: 'shoes' }
      ])
    })

    it('applies the archive row limit to the gear CSVs', async () => {
      const reader = await openArchive(
        [
          {
            name: 'bikes.csv',
            content: [
              'Bike ID,Bike Name',
              'b1,First bike',
              'b2,Second bike',
              'b3,Third bike'
            ].join('\n')
          }
        ],
        { maxCsvRows: 2 }
      )

      await expect(reader.getGear()).rejects.toThrow('exceeds CSV row limit')
    })

    it('refuses to open an archive whose gear file exceeds the entry limit', async () => {
      const filePath = join(archiveDirectory, `${randomUUID()}.zip`)
      await writeFile(
        filePath,
        buildStoredZip([
          { name: 'bikes.csv', content: 'Bike ID,Bike Name\n'.repeat(64) }
        ])
      )

      // Size limits are enforced while indexing, so an oversized gear file
      // fails the whole archive rather than surfacing inside getGear.
      await expect(
        StravaArchiveReader.open(filePath, {
          limits: { maxEntryUncompressedBytes: 16 }
        })
      ).rejects.toThrow('exceeds uncompressed size limit')
    })
  })
})

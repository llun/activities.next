import { EventEmitter } from 'events'
import fs from 'fs/promises'
import { promisify } from 'util'
import yauzl from 'yauzl'
import { gzip as gzipCallback } from 'zlib'

import {
  StravaArchiveLimitError,
  StravaArchiveReader,
  toStravaArchiveFitnessFilePayload
} from '@/lib/services/strava/archiveReader'

vi.mock('yauzl', () => ({
  __esModule: true,
  default: {
    open: vi.fn()
  }
}))

const mockYauzlOpen = yauzl.open as unknown as jest.MockedFunction<
  typeof yauzl.open
>
const gzip = promisify(gzipCallback)

describe('StravaArchiveReader.open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockZipFileWithEntries = (entries: yauzl.Entry[]) => {
    const zipFile = new EventEmitter() as unknown as yauzl.ZipFile
    let index = 0
    zipFile.readEntry = vi.fn(() => {
      process.nextTick(() => {
        const entry = entries[index]
        index += 1
        if (entry) {
          zipFile.emit('entry', entry)
          return
        }
        zipFile.emit('end')
      })
    })
    zipFile.close = vi.fn()
    return zipFile
  }

  const makeEntry = (overrides: Partial<yauzl.Entry>): yauzl.Entry =>
    ({
      fileName: 'activities/1.fit',
      compressionMethod: 8,
      compressedSize: 12,
      uncompressedSize: 34,
      ...overrides
    }) as yauzl.Entry

  it('opens yauzl zip with autoClose disabled', async () => {
    const zipFile = mockZipFileWithEntries([])

    mockYauzlOpen.mockImplementation((filePath, options, callback) => {
      callback(null, zipFile)
      return undefined as never
    })

    const reader = await StravaArchiveReader.open('/tmp/export.zip')

    expect(mockYauzlOpen).toHaveBeenCalledWith(
      '/tmp/export.zip',
      expect.objectContaining({
        lazyEntries: true,
        autoClose: false
      }),
      expect.any(Function)
    )

    reader.close()
    expect(zipFile.close).toHaveBeenCalled()
  })

  it('rejects archives with too many entries before indexing completes', async () => {
    const zipFile = mockZipFileWithEntries([
      makeEntry({ fileName: 'activities/1.fit' }),
      makeEntry({ fileName: 'activities/2.fit' }),
      makeEntry({ fileName: 'activities/3.fit' })
    ])
    mockYauzlOpen.mockImplementation((filePath, options, callback) => {
      callback(null, zipFile)
      return undefined as never
    })

    await expect(
      StravaArchiveReader.open('/tmp/export.zip', {
        limits: { maxEntries: 2 }
      })
    ).rejects.toThrow('exceeds entry limit')
    expect(zipFile.close).toHaveBeenCalled()
  })

  it('rejects 42.zip-style entries with oversized uncompressed data', async () => {
    const zipFile = mockZipFileWithEntries([
      makeEntry({
        fileName: 'activities/bomb.fit',
        compressedSize: 1,
        uncompressedSize: 1_000_000_000
      })
    ])
    mockYauzlOpen.mockImplementation((filePath, options, callback) => {
      callback(null, zipFile)
      return undefined as never
    })

    await expect(
      StravaArchiveReader.open('/tmp/export.zip', {
        limits: { maxEntryUncompressedBytes: 1024 }
      })
    ).rejects.toThrow('exceeds uncompressed size limit')
    expect(zipFile.close).toHaveBeenCalled()
  })

  it('rejects entries with oversized compressed data', async () => {
    const zipFile = mockZipFileWithEntries([
      makeEntry({
        fileName: 'activities/large.fit',
        compressedSize: 4096,
        uncompressedSize: 4096
      })
    ])
    mockYauzlOpen.mockImplementation((filePath, options, callback) => {
      callback(null, zipFile)
      return undefined as never
    })

    await expect(
      StravaArchiveReader.open('/tmp/export.zip', {
        limits: { maxEntryCompressedBytes: 1024 }
      })
    ).rejects.toThrow('exceeds compressed size limit')
    expect(zipFile.close).toHaveBeenCalled()
  })

  it('rejects archive entries with parent-directory traversal names', async () => {
    const zipFile = mockZipFileWithEntries([
      makeEntry({
        fileName: '../activities/evil.fit'
      })
    ])
    mockYauzlOpen.mockImplementation((filePath, options, callback) => {
      callback(null, zipFile)
      return undefined as never
    })

    await expect(StravaArchiveReader.open('/tmp/export.zip')).rejects.toThrow(
      'Unsafe archive entry path'
    )
    expect(zipFile.close).toHaveBeenCalled()
  })

  it('continues reading stored entries after partial fs reads', async () => {
    const localHeaderOffset = 8
    const entryData = Buffer.from('DATA')
    const header = Buffer.alloc(30)
    header.writeUInt16LE(0, 26)
    header.writeUInt16LE(0, 28)
    const zipBytes = Buffer.concat([
      Buffer.alloc(localHeaderOffset),
      header,
      entryData
    ])
    const zipFile = mockZipFileWithEntries([
      makeEntry({
        fileName: 'activities/stored.fit',
        compressionMethod: 0,
        compressedSize: entryData.byteLength,
        uncompressedSize: entryData.byteLength,
        relativeOffsetOfLocalHeader: localHeaderOffset
      })
    ])
    const readMock = vi.fn(
      async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number
      ) => {
        const bytesRead = Math.min(length, 2, zipBytes.byteLength - position)
        if (bytesRead <= 0) {
          return { bytesRead: 0, buffer }
        }
        zipBytes.copy(buffer, offset, position, position + bytesRead)
        return { bytesRead, buffer }
      }
    )
    const closeMock = vi.fn().mockResolvedValue(undefined)
    const openSpy = vi.spyOn(fs, 'open').mockResolvedValue({
      read: readMock,
      close: closeMock
    } as never)

    mockYauzlOpen.mockImplementation((filePath, options, callback) => {
      callback(null, zipFile)
      return undefined as never
    })

    try {
      const reader = await StravaArchiveReader.open('/tmp/export.zip')

      await expect(
        reader.readEntryBuffer('activities/stored.fit')
      ).resolves.toEqual(entryData)
      expect(readMock.mock.calls.length).toBeGreaterThan(2)

      reader.close()
    } finally {
      openSpy.mockRestore()
    }
  })

  it('keeps corrupt gzip activity errors distinct from gzip limit errors', async () => {
    await expect(
      toStravaArchiveFitnessFilePayload({
        fitnessFilePath: 'activities/corrupt.fit.gz',
        buffer: Buffer.from('not gzip data')
      })
    ).rejects.not.toBeInstanceOf(StravaArchiveLimitError)
  })

  it('wraps only gzip byte-limit errors as archive limit errors', async () => {
    await expect(
      toStravaArchiveFitnessFilePayload(
        {
          fitnessFilePath: 'activities/large.fit.gz',
          buffer: await gzip(Buffer.alloc(2048))
        },
        { maxGzipOutputBytes: 1024 }
      )
    ).rejects.toBeInstanceOf(StravaArchiveLimitError)
  })
})

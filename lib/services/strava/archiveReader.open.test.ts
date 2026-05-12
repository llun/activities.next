import { EventEmitter } from 'events'
import yauzl from 'yauzl'

import { StravaArchiveReader } from '@/lib/services/strava/archiveReader'

jest.mock('yauzl', () => ({
  __esModule: true,
  default: {
    open: jest.fn()
  }
}))

const mockYauzlOpen = yauzl.open as unknown as jest.MockedFunction<
  typeof yauzl.open
>

describe('StravaArchiveReader.open', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const mockZipFileWithEntries = (entries: yauzl.Entry[]) => {
    const zipFile = new EventEmitter() as unknown as yauzl.ZipFile
    let index = 0
    zipFile.readEntry = jest.fn(() => {
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
    zipFile.close = jest.fn()
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
  })
})

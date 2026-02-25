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

  it('opens yauzl zip with autoClose disabled', async () => {
    const zipFile = new EventEmitter() as unknown as yauzl.ZipFile
    zipFile.readEntry = jest.fn(() => {
      process.nextTick(() => {
        zipFile.emit('end')
      })
    })
    zipFile.close = jest.fn()

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
})

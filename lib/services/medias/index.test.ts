import { S3Client } from '@aws-sdk/client-s3'
import { promises as fs } from 'fs'

import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'

import * as S3FileStorage from './S3StorageFile'
import { deleteMediaFile } from './index'
import * as LocalFileStorage from './localFile'

jest.mock('fs', () => ({
  promises: {
    unlink: jest.fn()
  }
}))

jest.mock('@aws-sdk/client-s3')
jest.mock('../../config')
jest.mock('../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}))

jest.mock('./localFile')
jest.mock('./S3StorageFile')

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const mockUnlink = fs.unlink as jest.MockedFunction<typeof fs.unlink>
const mockS3Send = jest.fn()
const mockDeleteFile = jest.fn()

// Mock the storage getStorage methods
const mockLocalStorage = {
  deleteFile: mockDeleteFile
}
const mockS3Storage = {
  deleteFile: mockDeleteFile
}

jest
  .spyOn(LocalFileStorage.LocalFileStorage, 'getStorage')
  .mockReturnValue(mockLocalStorage as any)
jest
  .spyOn(S3FileStorage.S3FileStorage, 'getStorage')
  .mockReturnValue(mockS3Storage as any)

describe('Media Storage Service', () => {
  const mockDatabase = {} as any

  beforeEach(() => {
    jest.clearAllMocks()
    mockDeleteFile.mockReset()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      () =>
        ({
          send: mockS3Send
        }) as any
    )
  })

  describe('deleteMediaFile', () => {
    describe('LocalFile storage', () => {
      beforeEach(() => {
        mockGetConfig.mockReturnValue({
          mediaStorage: {
            type: MediaStorageType.LocalFile,
            path: '/tmp/media'
          },
          host: 'https://example.com'
        } as any)
      })

      it('deletes file from local filesystem', async () => {
        mockDeleteFile.mockResolvedValue(true)

        const result = await deleteMediaFile(mockDatabase, 'media/test.jpg')

        expect(result).toBe(true)
        expect(mockDeleteFile).toHaveBeenCalledWith('media/test.jpg')
      })

      it('returns true when file does not exist (ENOENT)', async () => {
        mockDeleteFile.mockResolvedValue(true)

        const result = await deleteMediaFile(mockDatabase, 'media/test.jpg')

        expect(result).toBe(true)
        expect(mockDeleteFile).toHaveBeenCalled()
      })

      it('returns false when deletion fails with other error', async () => {
        mockDeleteFile.mockResolvedValue(false)

        const result = await deleteMediaFile(mockDatabase, 'media/test.jpg')

        expect(result).toBe(false)
        expect(mockDeleteFile).toHaveBeenCalled()
      })

      it('handles paths with special characters', async () => {
        mockDeleteFile.mockResolvedValue(true)

        await deleteMediaFile(mockDatabase, 'media/file with spaces.jpg')

        expect(mockDeleteFile).toHaveBeenCalledWith(
          'media/file with spaces.jpg'
        )
      })
    })

    describe('S3Storage', () => {
      beforeEach(() => {
        mockGetConfig.mockReturnValue({
          mediaStorage: {
            type: MediaStorageType.S3Storage,
            bucket: 'test-bucket',
            region: 'us-west-2',
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret'
          },
          host: 'https://example.com'
        } as any)
      })

      it('deletes file from S3', async () => {
        mockDeleteFile.mockResolvedValue(true)

        const result = await deleteMediaFile(mockDatabase, 'media/test.jpg')

        expect(result).toBe(true)
        expect(mockDeleteFile).toHaveBeenCalledWith('media/test.jpg')
      })

      it('returns true when file does not exist (NoSuchKey)', async () => {
        mockDeleteFile.mockResolvedValue(true)

        const result = await deleteMediaFile(mockDatabase, 'media/test.jpg')

        expect(result).toBe(true)
        expect(mockDeleteFile).toHaveBeenCalled()
      })

      it('returns false when deletion fails with other error', async () => {
        mockDeleteFile.mockResolvedValue(false)

        const result = await deleteMediaFile(mockDatabase, 'media/test.jpg')

        expect(result).toBe(false)
        expect(mockDeleteFile).toHaveBeenCalled()
      })

      it('handles paths with special characters', async () => {
        mockDeleteFile.mockResolvedValue(true)

        await deleteMediaFile(mockDatabase, 'media/file%20with%20spaces.jpg')

        expect(mockDeleteFile).toHaveBeenCalledWith(
          'media/file%20with%20spaces.jpg'
        )
      })
    })

    describe('ObjectStorage', () => {
      beforeEach(() => {
        mockGetConfig.mockReturnValue({
          mediaStorage: {
            type: MediaStorageType.ObjectStorage,
            bucket: 'test-bucket',
            region: 'us-east-1',
            endpoint: 'https://s3.example.com',
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret'
          },
          host: 'https://example.com'
        } as any)
      })

      it('deletes file from object storage', async () => {
        mockDeleteFile.mockResolvedValue(true)

        const result = await deleteMediaFile(mockDatabase, 'media/test.jpg')

        expect(result).toBe(true)
        expect(mockDeleteFile).toHaveBeenCalled()
      })

      it('returns true when file does not exist', async () => {
        mockDeleteFile.mockResolvedValue(true)

        const result = await deleteMediaFile(mockDatabase, 'media/test.jpg')

        expect(result).toBe(true)
      })
    })

    describe('No storage configured', () => {
      beforeEach(() => {
        mockGetConfig.mockReturnValue({
          host: 'https://example.com'
        } as any)
      })

      it('returns false when no storage is configured', async () => {
        const result = await deleteMediaFile(mockDatabase, '/media/test.jpg')

        expect(result).toBe(false)
        expect(mockUnlink).not.toHaveBeenCalled()
        expect(mockS3Send).not.toHaveBeenCalled()
      })
    })
  })
})

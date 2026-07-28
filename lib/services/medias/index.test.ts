import { S3Client } from '@aws-sdk/client-s3'
import { promises as fs } from 'fs'

import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

import * as S3FileStorage from './S3StorageFile'
import { deleteMediaFile, saveMedia, saveMediaImageRendition } from './index'
import * as LocalFileStorage from './localFile'
import { MediaSchema } from './types'

vi.mock('fs', () => ({
  promises: {
    unlink: vi.fn()
  }
}))

vi.mock('@aws-sdk/client-s3')
vi.mock('@/lib/config')
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@/lib/services/medias/localFile')
vi.mock('@/lib/services/medias/S3StorageFile')

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const mockUnlink = fs.unlink as jest.MockedFunction<typeof fs.unlink>
const mockS3Send = vi.fn()
const mockDeleteFile = vi.fn()
const mockSaveImageRendition = vi.fn()
// saveFile is mocked per driver so a test can tell which storage was reached.
const mockLocalSaveFile = vi.fn()
const mockS3SaveFile = vi.fn()

// Mock the storage getStorage methods
const mockLocalStorage = {
  deleteFile: mockDeleteFile,
  saveImageRendition: mockSaveImageRendition,
  saveFile: mockLocalSaveFile
}
const mockS3Storage = {
  deleteFile: mockDeleteFile,
  saveImageRendition: mockSaveImageRendition,
  saveFile: mockS3SaveFile
}

vi.spyOn(LocalFileStorage.LocalFileStorage, 'getStorage').mockReturnValue(
  mockLocalStorage as unknown as ReturnType<
    typeof LocalFileStorage.LocalFileStorage.getStorage
  >
)
vi.spyOn(S3FileStorage.S3FileStorage, 'getStorage').mockReturnValue(
  mockS3Storage as unknown as ReturnType<
    typeof S3FileStorage.S3FileStorage.getStorage
  >
)

describe('Media Storage Service', () => {
  const mockDatabase = {} as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteFile.mockReset()
    mockSaveImageRendition.mockReset()
    mockLocalSaveFile.mockReset()
    mockS3SaveFile.mockReset()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return {
          send: mockS3Send
        } as unknown as S3Client
      }
    )
  })

  describe('saveMedia', () => {
    const actor = { id: 'actor-1' } as Actor
    const media: MediaSchema = {
      file: new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' })
    }
    const saveFileOutput = { id: 'media-1' }

    // Both S3-backed config types must reach the S3 driver: `s3` used to fall
    // through to the `default` branch, so every synchronous upload on an
    // instance configured with it was rejected with a 422.
    it.each([
      {
        description: 'delegates s3 storage to the s3 driver',
        mediaStorage: { type: MediaStorageType.S3Storage, bucket: 'bucket' }
      },
      {
        description: 'delegates object storage to the s3 driver',
        mediaStorage: { type: MediaStorageType.ObjectStorage, bucket: 'bucket' }
      }
    ])('$description', async ({ mediaStorage }) => {
      mockGetConfig.mockReturnValue({
        mediaStorage,
        host: 'llun.test'
      } as unknown as ReturnType<typeof getConfig>)
      mockS3SaveFile.mockResolvedValue(saveFileOutput)

      const result = await saveMedia(mockDatabase, actor, media)

      expect(result).toEqual(saveFileOutput)
      expect(mockS3SaveFile).toHaveBeenCalledWith(actor, media)
      expect(mockLocalSaveFile).not.toHaveBeenCalled()
    })

    it('delegates local file storage to the local driver', async () => {
      mockGetConfig.mockReturnValue({
        mediaStorage: { type: MediaStorageType.LocalFile, path: '/tmp/media' },
        host: 'llun.test'
      } as unknown as ReturnType<typeof getConfig>)
      mockLocalSaveFile.mockResolvedValue(saveFileOutput)

      const result = await saveMedia(mockDatabase, actor, media)

      expect(result).toEqual(saveFileOutput)
      expect(mockLocalSaveFile).toHaveBeenCalledWith(actor, media)
      expect(mockS3SaveFile).not.toHaveBeenCalled()
    })

    it('returns null when no storage is configured', async () => {
      mockGetConfig.mockReturnValue({
        host: 'llun.test'
      } as unknown as ReturnType<typeof getConfig>)

      const result = await saveMedia(mockDatabase, actor, media)

      expect(result).toBeNull()
      expect(mockLocalSaveFile).not.toHaveBeenCalled()
      expect(mockS3SaveFile).not.toHaveBeenCalled()
    })
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
        } as unknown as ReturnType<typeof getConfig>)
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
        } as unknown as ReturnType<typeof getConfig>)
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
        } as unknown as ReturnType<typeof getConfig>)
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
        } as unknown as ReturnType<typeof getConfig>)
      })

      it('returns false when no storage is configured', async () => {
        const result = await deleteMediaFile(mockDatabase, '/media/test.jpg')

        expect(result).toBe(false)
        expect(mockUnlink).not.toHaveBeenCalled()
        expect(mockS3Send).not.toHaveBeenCalled()
      })
    })
  })

  describe('saveMediaImageRendition', () => {
    const actor = { id: 'actor-1' } as Actor
    const file = new File(['png'], 'route-map.png', { type: 'image/png' })

    it.each([
      {
        description: 'delegates to local file storage',
        mediaStorage: { type: MediaStorageType.LocalFile, path: '/tmp/media' }
      },
      {
        description: 'delegates to s3 storage',
        mediaStorage: { type: MediaStorageType.S3Storage, bucket: 'bucket' }
      },
      {
        description: 'delegates to object storage',
        mediaStorage: { type: MediaStorageType.ObjectStorage, bucket: 'bucket' }
      }
    ])('$description', async ({ mediaStorage }) => {
      mockGetConfig.mockReturnValue({
        mediaStorage,
        host: 'llun.test'
      } as unknown as ReturnType<typeof getConfig>)
      mockSaveImageRendition.mockResolvedValue({ path: 'medias/map.jpg' })

      const result = await saveMediaImageRendition(
        mockDatabase,
        actor,
        file,
        'jpeg'
      )

      expect(result).toEqual({ path: 'medias/map.jpg' })
      expect(mockSaveImageRendition).toHaveBeenCalledWith(actor, file, 'jpeg')
    })

    it('returns null when no storage is configured', async () => {
      mockGetConfig.mockReturnValue({
        host: 'llun.test'
      } as unknown as ReturnType<typeof getConfig>)

      const result = await saveMediaImageRendition(
        mockDatabase,
        actor,
        file,
        'jpeg'
      )

      expect(result).toBeNull()
      expect(mockSaveImageRendition).not.toHaveBeenCalled()
    })
  })
})

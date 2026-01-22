import { promises as fs } from 'fs'
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'

import { deleteMediaFile } from './index'

jest.mock('fs', () => ({
  promises: {
    unlink: jest.fn()
  }
}))

jest.mock('@aws-sdk/client-s3')
jest.mock('../../config')

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const mockUnlink = fs.unlink as jest.MockedFunction<typeof fs.unlink>
const mockS3Send = jest.fn()

describe('Media Storage Service', () => {
  const mockDatabase = {} as any

  beforeEach(() => {
    jest.clearAllMocks()
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
          mockUnlink.mockResolvedValue(undefined)

          const result = await deleteMediaFile(mockDatabase, '/media/test.jpg')

          expect(result).toBe(true)
          expect(mockUnlink).toHaveBeenCalledWith('/tmp/media/media/test.jpg')
        })

        it('returns true when file does not exist (ENOENT)', async () => {
          const error = new Error('ENOENT: no such file or directory')
          ;(error as any).code = 'ENOENT'
          mockUnlink.mockRejectedValue(error)

          const result = await deleteMediaFile(mockDatabase, '/media/test.jpg')

          expect(result).toBe(true)
          expect(mockUnlink).toHaveBeenCalled()
        })

        it('returns false when deletion fails with other error', async () => {
          const error = new Error('Permission denied')
          ;(error as any).code = 'EACCES'
          mockUnlink.mockRejectedValue(error)

          const result = await deleteMediaFile(mockDatabase, '/media/test.jpg')

          expect(result).toBe(false)
          expect(mockUnlink).toHaveBeenCalled()
        })

        it('handles paths with special characters', async () => {
          mockUnlink.mockResolvedValue(undefined)

          await deleteMediaFile(mockDatabase, '/media/file with spaces.jpg')

          expect(mockUnlink).toHaveBeenCalledWith(
            '/tmp/media/media/file with spaces.jpg'
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
          mockS3Send.mockResolvedValue({})

          const result = await deleteMediaFile(mockDatabase, '/media/test.jpg')

          expect(result).toBe(true)
          expect(mockS3Send).toHaveBeenCalledWith(
            expect.any(DeleteObjectCommand)
          )
          const deleteCommand = mockS3Send.mock
            .calls[0][0] as DeleteObjectCommand
          expect(deleteCommand.input).toEqual({
            Bucket: 'test-bucket',
            Key: 'media/test.jpg'
          })
        })

        it('returns true when file does not exist (NoSuchKey)', async () => {
          const error = new Error('NoSuchKey')
          error.name = 'NoSuchKey'
          mockS3Send.mockRejectedValue(error)

          const result = await deleteMediaFile(mockDatabase, '/media/test.jpg')

          expect(result).toBe(true)
          expect(mockS3Send).toHaveBeenCalled()
        })

        it('returns false when deletion fails with other error', async () => {
          const error = new Error('AccessDenied')
          error.name = 'AccessDenied'
          mockS3Send.mockRejectedValue(error)

          const result = await deleteMediaFile(mockDatabase, '/media/test.jpg')

          expect(result).toBe(false)
          expect(mockS3Send).toHaveBeenCalled()
        })

        it('handles paths with special characters', async () => {
          mockS3Send.mockResolvedValue({})

          await deleteMediaFile(mockDatabase, '/media/file%20with%20spaces.jpg')

          expect(mockS3Send).toHaveBeenCalledWith(
            expect.any(DeleteObjectCommand)
          )
          const deleteCommand = mockS3Send.mock
            .calls[0][0] as DeleteObjectCommand
          expect(deleteCommand.input.Key).toBe('media/file%20with%20spaces.jpg')
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
          mockS3Send.mockResolvedValue({})

          const result = await deleteMediaFile(mockDatabase, '/media/test.jpg')

          expect(result).toBe(true)
          expect(mockS3Send).toHaveBeenCalledWith(
            expect.any(DeleteObjectCommand)
          )
        })

        it('returns true when file does not exist', async () => {
          const error = new Error('NoSuchKey')
          error.name = 'NoSuchKey'
          mockS3Send.mockRejectedValue(error)

          const result = await deleteMediaFile(mockDatabase, '/media/test.jpg')

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

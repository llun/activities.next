import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { S3FileStorage } from '@/lib/services/medias/S3StorageFile'
import { Actor } from '@/lib/types/domain/actor'

jest.mock('@aws-sdk/client-s3', () => {
  const makeCommand = (name: string) =>
    jest.fn().mockImplementation(function command(input) {
      this.input = input
      this.name = name
    })

  return {
    S3Client: jest.fn(),
    HeadObjectCommand: makeCommand('HeadObjectCommand'),
    DeleteObjectCommand: makeCommand('DeleteObjectCommand'),
    GetObjectCommand: makeCommand('GetObjectCommand'),
    PutObjectCommand: makeCommand('PutObjectCommand')
  }
})

describe('S3FileStorage presigned upload completion', () => {
  const send = jest.fn()
  const actor = {
    id: 'actor-1',
    account: { id: 'account-1' }
  } as Actor
  const checksumHex = 'a9993e364706816aba3e25717850c26c9cd0d89d'
  const checksumBase64 = Buffer.from(checksumHex, 'hex').toString('base64')

  const database = {
    getMediaByIdForAccount: jest.fn(),
    markMediaUploadVerified: jest.fn(),
    deleteMedia: jest.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      () => ({ send }) as unknown as S3Client
    )
    database.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/upload.png',
        bytes: 1024,
        mimeType: 'image/png',
        metaData: {
          width: 10,
          height: 10,
          upload: {
            state: 'pending',
            checksumSha1: checksumHex,
            contentType: 'image/png',
            size: 1024
          }
        },
        fileName: 'upload.png'
      }
    } as never)
    database.markMediaUploadVerified.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/upload.png',
        bytes: 1024,
        mimeType: 'image/png',
        metaData: {
          width: 10,
          height: 10,
          upload: {
            state: 'verified',
            checksumSha1: checksumHex,
            contentType: 'image/png',
            size: 1024,
            verifiedAt: 1
          }
        },
        fileName: 'upload.png'
      }
    } as never)
    database.deleteMedia.mockResolvedValue(true)
  })

  it('rejects oversized presigned uploads before marking media usable', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 2048,
          ContentType: 'image/png',
          ChecksumSHA1: checksumBase64
        }
      }
      if (command instanceof DeleteObjectCommand) {
        return {}
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        endpoint: 'https://s3.example.com'
      },
      'llun.test',
      database
    )

    await expect(
      storage.completePresignedUpload(actor, 'media-1')
    ).rejects.toThrow('does not match expected size')
    expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
    expect(database.deleteMedia).toHaveBeenCalledWith({ mediaId: 'media-1' })
  })
})

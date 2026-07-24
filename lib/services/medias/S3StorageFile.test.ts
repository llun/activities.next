import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable } from 'stream'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { S3FileStorage } from '@/lib/services/medias/S3StorageFile'
import { MAX_FILE_SIZE } from '@/lib/services/medias/constants'
import { getMaxMediaUploadSize } from '@/lib/services/medias/uploadSizeLimit'
import { Actor } from '@/lib/types/domain/actor'
import { StreamByteLimitError } from '@/lib/utils/streamLimit'

vi.mock('@aws-sdk/client-s3', () => {
  const makeCommand = (name: string) =>
    vi.fn().mockImplementation(function command(input) {
      this.input = input
      this.name = name
    })

  return {
    S3Client: vi.fn(),
    HeadObjectCommand: makeCommand('HeadObjectCommand'),
    DeleteObjectCommand: makeCommand('DeleteObjectCommand'),
    GetObjectCommand: makeCommand('GetObjectCommand'),
    PutObjectCommand: makeCommand('PutObjectCommand')
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://storage.example/upload')
}))

vi.mock('@/lib/services/medias/uploadSizeLimit', () => ({
  getMaxMediaUploadSize: vi.fn()
}))

describe('S3FileStorage presigned upload completion', () => {
  const send = vi.fn()
  const actor = {
    id: 'actor-1',
    account: { id: 'account-1' }
  } as Actor
  const checksumHex = 'a9993e364706816aba3e25717850c26c9cd0d89d'
  const checksumBase64 = Buffer.from(checksumHex, 'hex').toString('base64')

  const database = {
    createMedia: vi.fn(),
    getActorFromId: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn(),
    getMediaByIdForAccount: vi.fn(),
    getStorageUsageForAccount: vi.fn(),
    markMediaUploadVerified: vi.fn(),
    deleteMedia: vi.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(() => {
    vi.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
    database.createMedia.mockResolvedValue({
      id: 'media-1',
      actorId: 'actor-1',
      original: {
        path: 'medias/2026-01-01/upload.png',
        bytes: 1024,
        mimeType: 'image/png',
        metaData: {
          width: 10,
          height: 10
        },
        fileName: 'upload.png'
      }
    } as never)
    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
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
            checksumSha1Base64: checksumBase64,
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
            checksumSha1Base64: checksumBase64,
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

  it('uses the configured endpoint for the S3 client without treating hostname as the endpoint', () => {
    new S3FileStorage(
      {
        type: MediaStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'auto',
        hostname: 'static.llun.social',
        endpoint: 'https://account.r2.cloudflarestorage.com'
      },
      'llun.test',
      database
    )

    expect(S3Client).toHaveBeenCalledWith({
      region: 'auto',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      forcePathStyle: true
    })
  })

  it('signs checksum headers required by browser presigned uploads', async () => {
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

    const result = await storage.getPresigedForSaveFileUrl(actor, {
      fileName: 'upload.png',
      checksum: checksumHex,
      width: 10,
      height: 10,
      contentType: 'image/png',
      size: 1024
    })

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ChecksumSHA1: checksumBase64,
        Metadata: {
          checksumSha1: checksumHex
        }
      })
    )
    expect(getSignedUrl).toHaveBeenCalledTimes(1)
    const presignOptions = (getSignedUrl as jest.Mock).mock.calls[0][2]
    expect(presignOptions.expiresIn).toBe(600)
    expect(presignOptions.unhoistableHeaders.has('x-amz-checksum-sha1')).toBe(
      true
    )
    expect(
      presignOptions.unhoistableHeaders.has('x-amz-meta-checksumsha1')
    ).toBe(true)
    expect(result).toMatchObject({
      url: 'https://storage.example/upload',
      headers: {
        'x-amz-checksum-sha1': checksumBase64,
        'x-amz-meta-checksumsha1': checksumHex
      }
    })
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

  it('uses checksum metadata when S3 checksum fields are unavailable', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 1024,
          ContentType: 'image/png',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
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
    ).resolves.toMatchObject({ id: 'media-1' })
    expect(database.markMediaUploadVerified).toHaveBeenCalled()
    expect(database.deleteMedia).not.toHaveBeenCalled()
  })

  it('does not request checksum mode when verifying presigned uploads', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 1024,
          ContentType: 'image/png',
          Metadata: {
            checksumsha1: checksumHex
          }
        }
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

    await storage.completePresignedUpload(actor, 'media-1')

    expect(HeadObjectCommand).toHaveBeenCalledWith({
      Bucket: 'bucket',
      Key: 'medias/2026-01-01/upload.png'
    })
  })

  it('rejects uploads when no S3 checksum or checksum metadata is available', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 1024,
          ContentType: 'image/png',
          Metadata: {}
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
    ).rejects.toThrow('Uploaded object does not include expected checksum')
    expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
    expect(database.deleteMedia).toHaveBeenCalledWith({ mediaId: 'media-1' })
  })

  it('does not delete media records for transient verification errors', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        throw new Error('S3 timeout')
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
    ).rejects.toThrow('S3 timeout')
    expect(database.markMediaUploadVerified).not.toHaveBeenCalled()
    expect(database.deleteMedia).not.toHaveBeenCalled()
  })
})

describe('S3FileStorage getFile', () => {
  const send = vi.fn()
  const database = {} as unknown as jest.Mocked<Database>
  const storageConfig = {
    type: MediaStorageType.ObjectStorage,
    bucket: 'bucket',
    region: 'us-east-1',
    endpoint: 'https://s3.example.com',
    // The env-only storage cap, left at the built-in default.
    maxFileSize: MAX_FILE_SIZE
  } as const

  beforeEach(() => {
    vi.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
    send.mockResolvedValue({
      Body: Readable.from([Buffer.from('image-bytes')]),
      // Larger than the built-in default, smaller than the raised admin cap.
      ContentLength: 300 * 1024 * 1024,
      ContentType: 'image/png'
    })
  })

  // Regression: the read-back guard used to read the env-only storage config,
  // so media accepted under an admin-raised media.maxFileSize could never be
  // served back out.
  it('bounds the buffer by the resolved cap rather than the storage config', async () => {
    vi.mocked(getMaxMediaUploadSize).mockResolvedValue(500 * 1024 * 1024)
    const storage = new S3FileStorage(storageConfig, 'llun.test', database)

    await expect(storage.getFile('medias/upload.png')).resolves.toMatchObject({
      type: 'buffer',
      contentType: 'image/png'
    })
    expect(getMaxMediaUploadSize).toHaveBeenCalledWith(database)
  })

  it('refuses to buffer an object above the resolved cap', async () => {
    vi.mocked(getMaxMediaUploadSize).mockResolvedValue(MAX_FILE_SIZE)
    const storage = new S3FileStorage(storageConfig, 'llun.test', database)

    await expect(storage.getFile('medias/upload.png')).rejects.toThrow(
      StreamByteLimitError
    )
  })
})

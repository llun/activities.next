import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { S3FitnessStorage } from '@/lib/services/fitness-files/S3StorageFile'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
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

describe('S3FitnessStorage presigned upload verification', () => {
  const send = jest.fn()
  const actor = { id: 'actor-1' } as Actor
  const fitnessFile = {
    id: 'fitness-file-1',
    actorId: 'actor-1',
    path: '2026-01-01/archive.zip',
    fileName: 'archive.zip',
    fileType: 'zip',
    mimeType: 'application/zip',
    bytes: 1024
  } as FitnessFile
  const database = {
    deleteFitnessFile: jest.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      () => ({ send }) as unknown as S3Client
    )
  })

  it('returns false for missing S3 objects instead of throwing', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        const error = new Error('Not found') as Error & {
          $metadata?: { httpStatusCode?: number }
        }
        error.name = 'NotFound'
        error.$metadata = { httpStatusCode: 404 }
        throw error
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FitnessStorage(
      {
        type: FitnessStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        prefix: ''
      },
      'llun.test',
      database
    )

    await expect(
      storage.verifyPresignedUpload(actor, fitnessFile)
    ).resolves.toBe(false)
  })

  it('does not request checksum mode when verifying presigned uploads', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 1024,
          ContentType: 'application/zip'
        }
      }
      throw new Error('Unexpected command')
    })

    const storage = new S3FitnessStorage(
      {
        type: FitnessStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        prefix: ''
      },
      'llun.test',
      database
    )

    await expect(
      storage.verifyPresignedUpload(actor, fitnessFile)
    ).resolves.toBe(true)

    expect(HeadObjectCommand).toHaveBeenCalledWith({
      Bucket: 'bucket',
      Key: '2026-01-01/archive.zip'
    })
  })
})

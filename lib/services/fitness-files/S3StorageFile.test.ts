import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'

import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { S3FitnessStorage } from '@/lib/services/fitness-files/S3StorageFile'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { Actor } from '@/lib/types/domain/actor'

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
  getSignedUrl: vi.fn().mockResolvedValue('https://bucket.example.com/signed')
}))

describe('S3FitnessStorage presigned upload verification', () => {
  const send = vi.fn()
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
    deleteFitnessFile: vi.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(() => {
    vi.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
  })

  it('uses the configured endpoint for the S3 client without treating hostname as the endpoint', () => {
    new S3FitnessStorage(
      {
        type: FitnessStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'auto',
        hostname: 'fitness-cdn.example.com',
        endpoint: 'https://account.r2.cloudflarestorage.com',
        prefix: ''
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

describe('S3FitnessStorage stored file name', () => {
  const send = vi.fn()
  const actor = { id: 'actor-1', account: { id: 'account-1' } } as Actor
  const database = {
    createFitnessFile: vi.fn(),
    getActorFromId: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn(),
    getStorageUsageForAccount: vi.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(() => {
    vi.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
    send.mockResolvedValue({})
    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.createFitnessFile.mockResolvedValue({
      id: 'fitness-file-1'
    } as never)
  })

  const createStorage = () =>
    new S3FitnessStorage(
      {
        type: FitnessStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        prefix: ''
      },
      'llun.test',
      database
    )

  const storedRecord = () =>
    vi.mocked(database.createFitnessFile).mock.calls[0][0]

  it.each([
    {
      description: 'strips a POSIX directory prefix',
      fileName: '../../../etc/cron.d/ride.gpx',
      expected: 'ride.gpx'
    },
    {
      description: 'strips a Windows directory prefix',
      fileName: `..${String.fromCharCode(92)}..${String.fromCharCode(92)}ride.gpx`,
      expected: 'ride.gpx'
    },
    {
      description: 'strips a NUL byte',
      fileName: `ride.gpx${String.fromCharCode(0)}.exe`,
      expected: 'ride.gpx.exe'
    },
    {
      description: 'falls back when the name reduces to a directory reference',
      fileName: '.',
      expected: 'file'
    },
    {
      description: 'keeps an ordinary name unchanged',
      fileName: 'Morning Ride.gpx',
      expected: 'Morning Ride.gpx'
    }
  ])('saveFile $description', async ({ fileName, expected }) => {
    const file = new File([Buffer.from('<gpx/>')], fileName, {
      type: 'application/gpx+xml'
    })

    const output = await createStorage().saveFile(actor, { file })

    expect(storedRecord().fileName).toBe(expected)
    expect(output.fileName).toBe(expected)
  })

  // `fitness_files.fileName` is `varchar(255) not null`, so an unbounded name is
  // an insert failure on PostgreSQL — a 500 on an otherwise valid upload.
  it('saveFile caps an over-long name at the stored column width', async () => {
    const file = new File([Buffer.from('<gpx/>')], `${'a'.repeat(500)}.gpx`, {
      type: 'application/gpx+xml'
    })

    const output = await createStorage().saveFile(actor, { file })

    expect(Buffer.byteLength(storedRecord().fileName)).toBeLessThanOrEqual(200)
    expect(output.fileName).toBe(storedRecord().fileName)
  })

  // A guard, not a regression: the key has always come from a generated prefix
  // plus the allowlisted type, so a supplied name never reached it.
  it('saveFile keeps a traversing name out of the object key', async () => {
    const file = new File([Buffer.from('<gpx/>')], '../../../evil.gpx', {
      type: 'application/gpx+xml'
    })

    await createStorage().saveFile(actor, { file })

    expect(storedRecord().path).toMatch(
      /^\d{4}-\d{2}-\d{2}\/[0-9a-f]{16}\.gpx$/
    )
    expect(vi.mocked(PutObjectCommand).mock.calls[0][0].Key).toBe(
      storedRecord().path
    )
  })

  it.each([
    {
      description: 'strips a directory prefix',
      fileName: '../../../etc/cron.d/export.zip',
      expected: 'export.zip'
    },
    {
      description: 'falls back when the name reduces to nothing usable',
      fileName: `${String.fromCharCode(0x200b)}   `,
      expected: 'file'
    }
  ])(
    'getPresignedForSaveFileUrl $description',
    async ({ fileName, expected }) => {
      await createStorage().getPresignedForSaveFileUrl(actor, {
        fileName,
        contentType: 'application/zip',
        size: 1024
      })

      expect(storedRecord().fileName).toBe(expected)
    }
  )
})

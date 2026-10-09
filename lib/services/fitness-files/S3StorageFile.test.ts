import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { S3FitnessStorage } from '@/lib/services/fitness-files/S3StorageFile'
import { QuotaExceededError } from '@/lib/services/fitness-files/errors'
import {
  OVER_LONG_FITNESS_FILE_NAME,
  OVER_LONG_FITNESS_FILE_NAME_TRUNCATED,
  STORED_FITNESS_FILE_NAME_CASES
} from '@/lib/services/fitness-files/testUtils'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

vi.mock('@aws-sdk/client-s3', () => {
  const makeCommand = (name: string) =>
    vi.fn().mockImplementation(function command(
      this: { input?: unknown; name?: string },
      input: unknown
    ) {
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

  const saveFile = (fileName: string, type = 'application/gpx+xml') =>
    createStorage().saveFile(actor, {
      file: new File([Buffer.from('<gpx/>')], fileName, { type })
    })

  it.each(STORED_FITNESS_FILE_NAME_CASES)(
    'saveFile $description',
    async ({ fileName, expected }) => {
      const output = await saveFile(fileName)

      expect(storedRecord().fileName).toBe(expected)
      expect(output.fileName).toBe(expected)
    }
  )

  // `fitness_files.fileName` is `varchar(255) not null`, so an unbounded name is
  // an insert failure on PostgreSQL — a 500 on an otherwise valid upload.
  it('saveFile caps an over-long name at the stored column width', async () => {
    const output = await saveFile(OVER_LONG_FITNESS_FILE_NAME)

    expect(storedRecord().fileName).toBe(OVER_LONG_FITNESS_FILE_NAME_TRUNCATED)
    expect(output.fileName).toBe(OVER_LONG_FITNESS_FILE_NAME_TRUNCATED)
  })

  // The type comes from the raw name because sanitizing can truncate a long
  // name past its extension, and `getFitnessFileType` throws when neither the
  // name nor the MIME type identifies a type. This pins the ordering — hoisting
  // the sanitizer above the detection breaks this upload and nothing else.
  it('saveFile still detects the file type for a name the byte cap truncates', async () => {
    await saveFile(OVER_LONG_FITNESS_FILE_NAME, 'application/octet-stream')

    expect(storedRecord().fileType).toBe('gpx')
    expect(storedRecord().path).toMatch(
      /^\d{4}-\d{2}-\d{2}\/[0-9a-f]{16}\.gpx$/
    )
  })

  // A guard, not a regression: the key has always come from a generated prefix
  // plus the allowlisted type, so a supplied name never reached it.
  it('saveFile keeps a traversing name out of the object key', async () => {
    await saveFile('../../../evil.gpx')

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
    },
    {
      // This is the flow that takes the name as a plain JSON request field,
      // so it is the likeliest source of an over-long one.
      description: 'caps an over-long name at the stored column width',
      // The input can't reuse `OVER_LONG_FITNESS_FILE_NAME` — this route
      // requires `.zip` — but the cap drops the extension either way, so the
      // expected value is the shared one.
      fileName: `${'a'.repeat(500)}.zip`,
      expected: OVER_LONG_FITNESS_FILE_NAME_TRUNCATED
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

describe('S3FitnessStorage object access', () => {
  const send = vi.fn()
  const database = {} as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    ;(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      function () {
        return { send } as unknown as S3Client
      }
    )
  })

  const createStorage = (prefix = 'fitness/', maxFileSize?: number) =>
    new S3FitnessStorage(
      {
        type: FitnessStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        prefix,
        maxFileSize
      },
      'llun.test',
      database
    )

  const notFound = (name: string, httpStatusCode?: number) =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode } })

  describe('getFile', () => {
    it('reads the prefixed key and returns the bytes with the stored content type', async () => {
      send.mockResolvedValueOnce({
        Body: { transformToByteArray: async () => Buffer.from('fit-bytes') },
        ContentType: 'application/vnd.ant.fit',
        ContentLength: 9
      })

      const result = await createStorage().getFile('2026-01-01/a.fit')

      expect(result).toEqual({
        type: 'buffer',
        buffer: Buffer.from('fit-bytes'),
        contentType: 'application/vnd.ant.fit'
      })
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'bucket',
        Key: 'fitness/2026-01-01/a.fit'
      })
    })

    it('uses the bare path when there is no prefix and defaults the content type', async () => {
      send.mockResolvedValueOnce({
        Body: { transformToByteArray: async () => Buffer.from('x') }
      })

      const result = await createStorage('').getFile('a.fit')

      expect(result).toMatchObject({ contentType: 'application/octet-stream' })
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'bucket',
        Key: 'a.fit'
      })
    })

    it('returns null when the object has no body', async () => {
      send.mockResolvedValueOnce({})

      await expect(createStorage().getFile('a.fit')).resolves.toBeNull()
    })

    it.each([
      ['NoSuchKey', notFound('NoSuchKey')],
      ['NotFound', notFound('NotFound')],
      ['a 404 status', notFound('Whatever', 404)]
    ])('returns null when S3 reports %s', async (_, error) => {
      send.mockRejectedValueOnce(error)

      await expect(createStorage().getFile('a.fit')).resolves.toBeNull()
    })

    it('rethrows other S3 failures so they are not mistaken for a missing file', async () => {
      send.mockRejectedValueOnce(notFound('AccessDenied', 403))

      await expect(createStorage().getFile('a.fit')).rejects.toThrow(
        'AccessDenied'
      )
    })

    it('refuses an object whose declared length exceeds the file size limit', async () => {
      const transformToByteArray = vi.fn()
      send.mockResolvedValueOnce({
        Body: { transformToByteArray },
        ContentLength: 11
      })

      await expect(createStorage('', 10).getFile('big.fit')).rejects.toThrow(
        'Fitness object body exceeds byte limit of 10 bytes'
      )
      expect(transformToByteArray).not.toHaveBeenCalled()
    })
  })

  describe('deleteFile', () => {
    beforeEach(() => {
      vi.spyOn(logger, 'error').mockImplementation(() => logger)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('deletes the prefixed key and reports success', async () => {
      send.mockResolvedValueOnce({})

      await expect(createStorage().deleteFile('d/a.fit')).resolves.toBe(true)
      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'bucket',
        Key: 'fitness/d/a.fit'
      })
    })

    it('treats an already-missing object as deleted', async () => {
      send.mockRejectedValueOnce(notFound('NoSuchKey'))

      await expect(createStorage().deleteFile('d/a.fit')).resolves.toBe(true)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('reports false and logs when S3 refuses the delete', async () => {
      send.mockRejectedValueOnce(notFound('AccessDenied', 403))

      await expect(createStorage().deleteFile('d/a.fit')).resolves.toBe(false)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to delete fitness file from S3',
          filePath: 'd/a.fit',
          error: 'AccessDenied'
        })
      )
    })
  })
})

describe('S3FitnessStorage uploads', () => {
  const send = vi.fn()
  const actor = { id: 'actor-1', account: { id: 'account-1' } } as Actor
  const database = {
    createFitnessFile: vi.fn(),
    deleteFitnessFile: vi.fn(),
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
    database.deleteFitnessFile.mockResolvedValue(true)
    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.createFitnessFile.mockResolvedValue({
      id: 'fitness-file-1'
    } as never)
  })

  const createStorage = (host = 'llun.test', prefix = 'fitness/') =>
    new S3FitnessStorage(
      {
        type: FitnessStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        prefix
      },
      host,
      database
    )

  const gpx = (name = 'run.gpx') =>
    new File([Buffer.from('<gpx/>')], name, { type: 'application/gpx+xml' })

  describe('saveFile', () => {
    it('uploads under the prefix and records the relative path with its metadata', async () => {
      const output = await createStorage().saveFile(actor, {
        file: gpx(),
        description: 'Morning run',
        importBatchId: 'batch-1',
        sourceUrl: 'https://www.strava.com/activities/1'
      })

      const put = vi.mocked(PutObjectCommand).mock.calls[0][0]
      const record = vi.mocked(database.createFitnessFile).mock.calls[0][0]
      expect(put).toMatchObject({
        Bucket: 'bucket',
        ContentType: 'application/gpx+xml',
        ContentLength: 6
      })
      expect(put.Key).toBe(`fitness/${record.path}`)
      expect(record).toMatchObject({
        actorId: 'actor-1',
        fileName: 'run.gpx',
        fileType: 'gpx',
        mimeType: 'application/gpx+xml',
        bytes: 6,
        description: 'Morning run',
        importBatchId: 'batch-1',
        sourceUrl: 'https://www.strava.com/activities/1'
      })
      expect(output).toEqual({
        id: 'fitness-file-1',
        type: 'fitness',
        file_type: 'gpx',
        mime_type: 'application/gpx+xml',
        url: 'https://llun.test/api/v1/fitness-files/fitness-file-1',
        fileName: 'run.gpx',
        size: 6,
        description: 'Morning run',
        hasMapData: false
      })
    })

    it.each([
      ['localhost:3000', 'http'],
      ['127.0.0.1:3000', 'http'],
      ['[::1]:3000', 'http'],
      ['llun.test', 'https']
    ])('builds the file url for host %s with %s', async (host, protocol) => {
      const output = await createStorage(host).saveFile(actor, {
        file: gpx()
      })

      expect(output.url).toBe(
        `${protocol}://${host}/api/v1/fitness-files/fitness-file-1`
      )
    })

    it('throws QuotaExceededError without touching S3 when the account is over quota', async () => {
      database.getStorageUsageForAccount.mockResolvedValue(
        Number.MAX_SAFE_INTEGER
      )

      const error = await createStorage()
        .saveFile(actor, { file: gpx() })
        .catch((e) => e)

      expect(error).toBeInstanceOf(QuotaExceededError)
      expect(error.used).toBe(Number.MAX_SAFE_INTEGER)
      expect(send).not.toHaveBeenCalled()
      expect(database.createFitnessFile).not.toHaveBeenCalled()
    })

    it('throws when the database record cannot be created', async () => {
      database.createFitnessFile.mockResolvedValue(null as never)

      await expect(
        createStorage().saveFile(actor, { file: gpx() })
      ).rejects.toThrow('Failed to store fitness file')
    })
  })

  describe('getPresignedForSaveFileUrl', () => {
    it('returns a signed PUT url and pre-creates the zip record', async () => {
      const result = await createStorage().getPresignedForSaveFileUrl(actor, {
        fileName: 'export.zip',
        contentType: 'application/zip',
        size: 2048,
        importBatchId: 'batch-9',
        description: 'Strava export'
      })

      expect(result).toEqual({
        url: 'https://bucket.example.com/signed',
        fitnessFileId: 'fitness-file-1'
      })
      const put = vi.mocked(PutObjectCommand).mock.calls[0][0]
      expect(put).toMatchObject({
        Bucket: 'bucket',
        ContentType: 'application/zip',
        ContentLength: 2048
      })
      expect(put.Key).toMatch(/^fitness\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{16}\.zip$/)
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 3600 }
      )
      expect(database.createFitnessFile).toHaveBeenCalledWith({
        actorId: 'actor-1',
        path: put.Key!.replace('fitness/', ''),
        fileName: 'export.zip',
        fileType: 'zip',
        mimeType: 'application/zip',
        bytes: 2048,
        description: 'Strava export',
        importBatchId: 'batch-9'
      })
    })

    it('refuses an upload that would exceed the quota before signing anything', async () => {
      database.getFitnessStorageUsageForAccount.mockResolvedValue(
        Number.MAX_SAFE_INTEGER
      )

      await expect(
        createStorage().getPresignedForSaveFileUrl(actor, {
          fileName: 'export.zip',
          contentType: 'application/zip',
          size: 1
        })
      ).rejects.toBeInstanceOf(QuotaExceededError)
      expect(getSignedUrl).not.toHaveBeenCalled()
      expect(database.createFitnessFile).not.toHaveBeenCalled()
    })

    it('throws when the placeholder record cannot be created', async () => {
      database.createFitnessFile.mockResolvedValue(null as never)

      await expect(
        createStorage().getPresignedForSaveFileUrl(actor, {
          fileName: 'export.zip',
          contentType: 'application/zip',
          size: 1
        })
      ).rejects.toThrow(
        'Failed to pre-create fitness file record for presigned upload'
      )
    })
  })

  describe('verifyPresignedUpload', () => {
    const upload = {
      id: 'fitness-file-1',
      actorId: 'actor-1',
      path: '2026-01-01/archive.zip',
      mimeType: 'application/zip',
      bytes: 1024
    } as FitnessFile

    it('rejects another actor’s upload without asking S3', async () => {
      await expect(
        createStorage().verifyPresignedUpload(
          { id: 'someone-else' } as Actor,
          upload
        )
      ).resolves.toBe(false)
      expect(send).not.toHaveBeenCalled()
      expect(database.deleteFitnessFile).not.toHaveBeenCalled()
    })

    it('checks the prefixed key and ignores content type parameters and case', async () => {
      send.mockResolvedValueOnce({
        ContentLength: 1024,
        ContentType: 'Application/ZIP; charset=binary'
      })

      await expect(
        createStorage().verifyPresignedUpload(actor, upload)
      ).resolves.toBe(true)
      expect(HeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'bucket',
        Key: 'fitness/2026-01-01/archive.zip'
      })
      expect(database.deleteFitnessFile).not.toHaveBeenCalled()
    })

    it.each([
      ['size', { ContentLength: 999, ContentType: 'application/zip' }],
      ['content type', { ContentLength: 1024, ContentType: 'text/html' }]
    ])(
      'deletes the object and the record when the uploaded %s does not match',
      async (_, head) => {
        send.mockImplementation(async (command) => {
          if (command instanceof HeadObjectCommand) return head
          return {}
        })

        await expect(
          createStorage().verifyPresignedUpload(actor, upload)
        ).resolves.toBe(false)

        expect(DeleteObjectCommand).toHaveBeenCalledWith({
          Bucket: 'bucket',
          Key: 'fitness/2026-01-01/archive.zip'
        })
        expect(database.deleteFitnessFile).toHaveBeenCalledWith({
          id: 'fitness-file-1'
        })
      }
    )

    it('still reports a mismatch when cleanup itself fails', async () => {
      database.deleteFitnessFile.mockRejectedValue(new Error('db down'))
      send.mockImplementation(async (command) => {
        if (command instanceof HeadObjectCommand) {
          return { ContentLength: 1, ContentType: 'application/zip' }
        }
        throw new Error('s3 down')
      })

      await expect(
        createStorage().verifyPresignedUpload(actor, upload)
      ).resolves.toBe(false)
    })

    it('propagates S3 errors other than not-found', async () => {
      send.mockRejectedValueOnce(
        Object.assign(new Error('Forbidden'), {
          name: 'Forbidden',
          $metadata: { httpStatusCode: 403 }
        })
      )

      await expect(
        createStorage().verifyPresignedUpload(actor, upload)
      ).rejects.toThrow('Forbidden')
    })
  })
})

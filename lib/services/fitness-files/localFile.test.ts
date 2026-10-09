import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { QuotaExceededError } from '@/lib/services/fitness-files/errors'
import { LocalFileFitnessStorage } from '@/lib/services/fitness-files/localFile'
import {
  OVER_LONG_FITNESS_FILE_NAME,
  OVER_LONG_FITNESS_FILE_NAME_TRUNCATED,
  STORED_FITNESS_FILE_NAME_CASES
} from '@/lib/services/fitness-files/testUtils'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

// `resolveStorageFilePath` warns when it refuses a path, and the containment
// test below deliberately makes it refuse twice.
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

describe('LocalFileFitnessStorage path containment', () => {
  let tempParent: string
  let storageRoot: string
  let outsideFile: string

  beforeEach(async () => {
    tempParent = await fs.mkdtemp(path.join(os.tmpdir(), 'fitness-storage-'))
    storageRoot = path.join(tempParent, 'root')
    outsideFile = path.join(tempParent, 'secret.fit')
    await fs.mkdir(storageRoot)
    await fs.writeFile(outsideFile, 'secret')
  })

  afterEach(async () => {
    await fs.rm(tempParent, { recursive: true, force: true })
  })

  it('refuses to read or delete files outside the resolved storage root', async () => {
    const storage = new LocalFileFitnessStorage(
      {
        type: FitnessStorageType.LocalFile,
        path: storageRoot
      },
      'localhost:3000',
      {} as Database
    )

    await expect(storage.getFile('../secret.fit')).resolves.toBeNull()
    await expect(storage.deleteFile('../secret.fit')).resolves.toBe(false)
    await expect(fs.readFile(outsideFile, 'utf8')).resolves.toBe('secret')
  })
})

describe('LocalFileFitnessStorage.saveFile stored file name', () => {
  let tempParent: string
  let storageRoot: string

  const actor = { id: 'actor-1', account: { id: 'account-1' } } as Actor

  const database = {
    createFitnessFile: vi.fn(),
    getActorFromId: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn(),
    getStorageUsageForAccount: vi.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(async () => {
    vi.clearAllMocks()
    tempParent = await fs.mkdtemp(path.join(os.tmpdir(), 'fitness-storage-'))
    storageRoot = path.join(tempParent, 'root')
    await fs.mkdir(storageRoot)

    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.createFitnessFile.mockResolvedValue({
      id: 'fitness-file-1'
    } as never)
  })

  afterEach(async () => {
    await fs.rm(tempParent, { recursive: true, force: true })
  })

  const createStorage = () =>
    new LocalFileFitnessStorage(
      {
        type: FitnessStorageType.LocalFile,
        path: storageRoot
      },
      'llun.test',
      database
    )

  const saveFile = async (fileName: string, type = 'application/gpx+xml') => {
    const file = new File([Buffer.from('<gpx/>')], fileName, { type })
    const output = await createStorage().saveFile(actor, { file })
    return {
      output,
      stored: vi.mocked(database.createFitnessFile).mock.calls[0][0]
    }
  }

  it.each(STORED_FITNESS_FILE_NAME_CASES)(
    '$description',
    async ({ fileName, expected }) => {
      const { output, stored } = await saveFile(fileName)

      expect(stored.fileName).toBe(expected)
      expect(output.fileName).toBe(expected)
    }
  )

  // `fitness_files.fileName` is `varchar(255) not null`, so an unbounded name is
  // an insert failure on PostgreSQL — a 500 on an otherwise valid upload.
  it('caps an over-long name at the stored column width', async () => {
    const { output, stored } = await saveFile(OVER_LONG_FITNESS_FILE_NAME)

    expect(stored.fileName).toBe(OVER_LONG_FITNESS_FILE_NAME_TRUNCATED)
    expect(output.fileName).toBe(OVER_LONG_FITNESS_FILE_NAME_TRUNCATED)
  })

  // The type comes from the raw name because sanitizing can truncate a long
  // name past its extension, and `getFitnessFileType` throws when neither the
  // name nor the MIME type identifies a type. This pins the ordering — hoisting
  // the sanitizer above the detection breaks this upload and nothing else.
  it('still detects the file type for a name the byte cap truncates', async () => {
    const { stored } = await saveFile(
      OVER_LONG_FITNESS_FILE_NAME,
      'application/octet-stream'
    )

    expect(stored.fileType).toBe('gpx')
    expect(stored.path).toMatch(/^\d{4}-\d{2}-\d{2}\/[0-9a-f]{16}\.gpx$/)
  })

  // A guard, not a regression: the path has always come from a generated prefix
  // plus the allowlisted type, so a supplied name never reached it. Keep the
  // guard so that stays true.
  it('keeps a traversing name out of the storage path', async () => {
    const { stored } = await saveFile('../../../evil.gpx')

    expect(stored.path).toMatch(/^\d{4}-\d{2}-\d{2}\/[0-9a-f]{16}\.gpx$/)
    const [datedDirectory] = await fs.readdir(storageRoot)
    await expect(
      fs.readdir(path.join(storageRoot, datedDirectory))
    ).resolves.toEqual([path.basename(stored.path)])
  })
})

describe('LocalFileFitnessStorage file access and uploads', () => {
  let tempParent: string
  let storageRoot: string

  const actor = { id: 'actor-1', account: { id: 'account-1' } } as Actor
  const database = {
    createFitnessFile: vi.fn(),
    getActorFromId: vi.fn(),
    getFitnessStorageUsageForAccount: vi.fn(),
    getStorageUsageForAccount: vi.fn()
  } as unknown as jest.Mocked<Database>

  beforeEach(async () => {
    vi.clearAllMocks()
    tempParent = await fs.mkdtemp(path.join(os.tmpdir(), 'fitness-storage-'))
    storageRoot = path.join(tempParent, 'root')
    await fs.mkdir(storageRoot)

    database.getActorFromId.mockResolvedValue(actor)
    database.getStorageUsageForAccount.mockResolvedValue(0)
    database.getFitnessStorageUsageForAccount.mockResolvedValue(0)
    database.createFitnessFile.mockResolvedValue({
      id: 'fitness-file-1'
    } as never)
  })

  afterEach(async () => {
    await fs.rm(tempParent, { recursive: true, force: true })
  })

  const createStorage = (host = 'llun.test') =>
    new LocalFileFitnessStorage(
      { type: FitnessStorageType.LocalFile, path: storageRoot },
      host,
      database
    )

  describe('getFile', () => {
    it('returns the stored bytes', async () => {
      await fs.mkdir(path.join(storageRoot, '2026-01-01'))
      await fs.writeFile(
        path.join(storageRoot, '2026-01-01', 'a.fit'),
        Buffer.from([1, 2, 3])
      )

      const result = await createStorage().getFile('2026-01-01/a.fit')

      expect(result).toMatchObject({
        type: 'buffer',
        buffer: Buffer.from([1, 2, 3])
      })
    })

    it.each([
      ['a.fit', 'application/vnd.ant.fit'],
      ['a.gpx', 'application/gpx+xml'],
      ['a.tcx', 'application/vnd.garmin.tcx+xml'],
      ['a.ZIP', 'application/zip'],
      ['a.bin', 'application/octet-stream']
    ])('serves %s as %s', async (fileName, expected) => {
      await fs.writeFile(path.join(storageRoot, fileName), 'x')

      const result = await createStorage().getFile(fileName)

      expect(result).toMatchObject({
        contentType: expect.stringContaining(expected)
      })
    })

    it('returns null and logs when the file is missing', async () => {
      await expect(createStorage().getFile('missing.fit')).resolves.toBeNull()

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to read fitness file',
          filePath: 'missing.fit'
        })
      )
    })
  })

  describe('deleteFile', () => {
    it('removes the file from disk', async () => {
      const target = path.join(storageRoot, 'a.fit')
      await fs.writeFile(target, 'x')

      await expect(createStorage().deleteFile('a.fit')).resolves.toBe(true)
      await expect(fs.access(target)).rejects.toThrow()
    })

    it('treats an already-missing file as deleted', async () => {
      await expect(createStorage().deleteFile('gone.fit')).resolves.toBe(true)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('reports false and logs when the path cannot be unlinked', async () => {
      await fs.mkdir(path.join(storageRoot, 'a-directory'))

      await expect(createStorage().deleteFile('a-directory')).resolves.toBe(
        false
      )
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to delete fitness file from local storage',
          filePath: 'a-directory'
        })
      )
    })
  })

  describe('saveFile', () => {
    const gpx = () =>
      new File([Buffer.from('<gpx/>')], 'run.gpx', {
        type: 'application/gpx+xml'
      })

    it('writes the bytes to a dated random path and records the upload', async () => {
      const output = await createStorage().saveFile(actor, {
        file: gpx(),
        description: 'Morning run',
        importBatchId: 'batch-1',
        sourceUrl: 'https://www.strava.com/activities/1'
      })

      const record = vi.mocked(database.createFitnessFile).mock.calls[0][0]
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
      await expect(
        fs.readFile(path.join(storageRoot, record.path), 'utf8')
      ).resolves.toBe('<gpx/>')
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
      const output = await createStorage(host).saveFile(actor, { file: gpx() })

      expect(output.url).toBe(
        `${protocol}://${host}/api/v1/fitness-files/fitness-file-1`
      )
    })

    it('throws QuotaExceededError and writes nothing when the account is over quota', async () => {
      database.getFitnessStorageUsageForAccount.mockResolvedValue(
        Number.MAX_SAFE_INTEGER
      )

      await expect(
        createStorage().saveFile(actor, { file: gpx() })
      ).rejects.toBeInstanceOf(QuotaExceededError)

      expect(database.createFitnessFile).not.toHaveBeenCalled()
      await expect(fs.readdir(storageRoot)).resolves.toEqual([])
    })

    it('throws when the database record cannot be created', async () => {
      database.createFitnessFile.mockResolvedValue(null as never)

      await expect(
        createStorage().saveFile(actor, { file: gpx() })
      ).rejects.toThrow('Failed to store fitness file')
    })
  })

  describe('presigned uploads', () => {
    it('are not offered, since local storage takes uploads through the server', async () => {
      const storage = createStorage()

      await expect(
        storage.getPresignedForSaveFileUrl(actor, {
          fileName: 'a.zip',
          contentType: 'application/zip',
          size: 1
        })
      ).resolves.toBeNull()
      await expect(storage.verifyPresignedUpload()).resolves.toBe(false)
    })
  })
})

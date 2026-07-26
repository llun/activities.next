import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { LocalFileFitnessStorage } from '@/lib/services/fitness-files/localFile'
import {
  OVER_LONG_FITNESS_FILE_NAME,
  OVER_LONG_FITNESS_FILE_NAME_TRUNCATED,
  STORED_FITNESS_FILE_NAME_CASES
} from '@/lib/services/fitness-files/testUtils'
import { Actor } from '@/lib/types/domain/actor'

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

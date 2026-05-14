import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { LocalFileFitnessStorage } from '@/lib/services/fitness-files/localFile'

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

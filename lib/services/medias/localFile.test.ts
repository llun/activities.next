import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'

import { LocalFileStorage } from './localFile'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

describe('LocalFileStorage.getFile', () => {
  let tempDir: string
  let mediaRoot: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'activities-media-'))
    mediaRoot = path.join(tempDir, 'media')
    await fs.mkdir(mediaRoot)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const createStorage = () =>
    new LocalFileStorage(
      {
        type: MediaStorageType.LocalFile,
        path: mediaRoot
      },
      'llun.test',
      {} as Database
    )

  it('reads files inside the media root', async () => {
    await fs.writeFile(path.join(mediaRoot, 'avatar.png'), 'image-data')

    const result = await createStorage().getFile('avatar.png')

    expect(result).toMatchObject({
      type: 'buffer',
      contentType: 'image/png'
    })
    expect(result?.type === 'buffer' ? result.buffer.toString() : null).toBe(
      'image-data'
    )
  })

  it('returns null when a relative path escapes the media root', async () => {
    await fs.mkdir(path.join(mediaRoot, 'nested'))
    await fs.writeFile(path.join(tempDir, 'secret.png'), 'secret-data')

    const result = await createStorage().getFile('nested/../../secret.png')

    expect(result).toBeNull()
  })

  it('returns null when an absolute path escapes the media root', async () => {
    const outsidePath = path.join(tempDir, 'absolute-secret.png')
    await fs.writeFile(outsidePath, 'secret-data')

    const result = await createStorage().getFile(outsidePath)

    expect(result).toBeNull()
  })
})

import { getConfig } from '@/lib/config'
import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { deleteMediaFile } from '@/lib/services/medias'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { Actor } from '@/lib/types/domain/actor'

import { S3FitnessStorage } from './S3StorageFile'
import {
  deleteFitnessFile,
  getEffectiveFitnessStorageConfig,
  getFitnessFile,
  getFitnessFileBuffer,
  getPresignedFitnessFileUrl,
  saveFitnessFile,
  verifyPresignedFitnessFileUpload
} from './index'
import { LocalFileFitnessStorage } from './localFile'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
  getBaseURL: vi.fn().mockReturnValue('https://llun.test')
}))

vi.mock('@/lib/services/medias', () => ({
  deleteMediaFile: vi.fn()
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const mockDeleteMediaFile = deleteMediaFile as jest.MockedFunction<
  typeof deleteMediaFile
>

describe('deleteFitnessFile', () => {
  const storageDeleteFile = vi.fn()

  const database = {
    getFitnessFile: vi.fn(),
    deleteFitnessFile: vi.fn(),
    updateFitnessFileActivityData: vi.fn()
  } as unknown as jest.Mocked<Database>

  const fitnessFile = {
    id: 'fitness-1',
    actorId: 'https://llun.test/users/test1',
    path: 'fitness/morning-run.fit',
    fileName: 'morning-run.fit',
    fileType: 'fit',
    mimeType: 'application/vnd.ant.fit',
    bytes: 2_048,
    mapImagePath: 'medias/2026-07-26/route-map.webp',
    mapImageEmailPath: 'medias/2026-07-26/route-map.jpg',
    createdAt: 1,
    updatedAt: 1
  } as FitnessFile

  // Both storage branches run the same cleanup, so both are exercised rather
  // than trusting the local one to stand in for object storage.
  const storageBackends = [
    {
      description: 'local file storage',
      fitnessStorage: {
        type: FitnessStorageType.LocalFile,
        path: '/tmp/fitness'
      },
      storageClass: LocalFileFitnessStorage
    },
    {
      description: 'object storage',
      fitnessStorage: {
        type: FitnessStorageType.ObjectStorage,
        bucket: 'bucket',
        region: 'us-east-1',
        prefix: 'fitness/'
      },
      storageClass: S3FitnessStorage
    }
  ]

  const arrangeStorage = (backend: (typeof storageBackends)[number]) => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      fitnessStorage: backend.fitnessStorage
    } as unknown as ReturnType<typeof getConfig>)

    vi.spyOn(
      backend.storageClass as unknown as {
        getStorage: (...args: unknown[]) => unknown
      },
      'getStorage'
    ).mockReturnValue({
      deleteFile: storageDeleteFile
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    storageDeleteFile.mockResolvedValue(true)
    mockDeleteMediaFile.mockResolvedValue(true)
    database.deleteFitnessFile.mockResolvedValue(true)
    database.updateFitnessFileActivityData.mockResolvedValue(true)
    arrangeStorage(storageBackends[0])
  })

  it.each(storageBackends)(
    'deletes the route map email copy along with the activity on $description',
    async (backend) => {
      arrangeStorage(backend)

      const deleted = await deleteFitnessFile(
        database,
        'fitness-1',
        fitnessFile
      )

      expect(deleted).toBe(true)
      expect(storageDeleteFile).toHaveBeenCalledWith('fitness/morning-run.fit')
      expect(database.deleteFitnessFile).toHaveBeenCalledWith({
        id: 'fitness-1'
      })
      // The copy has no `medias` row, so no generic media-cleanup path can find
      // it — deleting the activity has to delete it explicitly, or the route
      // stays fetchable at its old URL.
      expect(mockDeleteMediaFile).toHaveBeenCalledWith(
        database,
        'medias/2026-07-26/route-map.jpg'
      )
      // The row is only soft-deleted, so the reference has to go too: a row
      // pointing at a deleted object makes productionArchive abort under its
      // default referenced scope.
      expect(database.updateFitnessFileActivityData).toHaveBeenCalledWith(
        'fitness-1',
        { mapImageEmailPath: null }
      )
    }
  )

  it('deletes nothing extra when the activity has no email copy', async () => {
    const deleted = await deleteFitnessFile(database, 'fitness-1', {
      ...fitnessFile,
      mapImageEmailPath: undefined
    })

    expect(deleted).toBe(true)
    expect(mockDeleteMediaFile).not.toHaveBeenCalled()
    expect(database.updateFitnessFileActivityData).not.toHaveBeenCalled()
  })

  it('still deletes the activity when removing the email copy fails', async () => {
    mockDeleteMediaFile.mockRejectedValue(new Error('storage unavailable'))

    const deleted = await deleteFitnessFile(database, 'fitness-1', fitnessFile)

    expect(deleted).toBe(true)
    expect(database.deleteFitnessFile).toHaveBeenCalled()
  })

  it('leaves the email copy alone when the activity file could not be deleted', async () => {
    storageDeleteFile.mockResolvedValue(false)

    const deleted = await deleteFitnessFile(database, 'fitness-1', fitnessFile)

    expect(deleted).toBe(false)
    expect(database.deleteFitnessFile).not.toHaveBeenCalled()
    expect(mockDeleteMediaFile).not.toHaveBeenCalled()
  })
})

describe('getEffectiveFitnessStorageConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ACTIVITIES_FITNESS_STORAGE_TYPE
    mockGetConfig.mockReset()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  const mediaOnlyConfig = {
    mediaStorage: {
      type: MediaStorageType.S3Storage,
      bucket: 'media-bucket',
      region: 'us-east-1',
      hostname: 'media-cdn.example.com'
    }
  } as unknown as ReturnType<typeof getConfig>

  it('falls back to media object storage when fitness storage was never configured', () => {
    mockGetConfig.mockReturnValue(mediaOnlyConfig)

    const config = getEffectiveFitnessStorageConfig()

    expect(config).toMatchObject({
      type: MediaStorageType.S3Storage,
      bucket: 'media-bucket',
      prefix: 'fitness/'
    })
  })

  // The resolver returns null both for "never configured" and for "configured
  // but disabled because a required value was blank". Only the first may
  // inherit media storage — otherwise a blank ACTIVITIES_FITNESS_STORAGE_BUCKET
  // writes fitness files into the media bucket right after warning that fitness
  // storage is disabled.
  it('does not fall back to media storage when a fitness type is configured', () => {
    process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 's3'
    mockGetConfig.mockReturnValue(mediaOnlyConfig)

    expect(getEffectiveFitnessStorageConfig()).toBeNull()
  })
})

describe('fitness file storage dispatch', () => {
  const originalEnv = process.env
  const actor = { id: 'https://llun.test/users/test1' } as Actor
  const fitnessFile = {
    id: 'fitness-1',
    actorId: actor.id,
    path: '2026-01-01/run.fit'
  } as FitnessFile
  const database = {
    getFitnessFile: vi.fn(),
    deleteFitnessFile: vi.fn()
  } as unknown as jest.Mocked<Database>

  const localConfig = {
    type: FitnessStorageType.LocalFile,
    path: '/tmp/fitness'
  }
  const s3Config = {
    type: FitnessStorageType.S3Storage,
    bucket: 'bucket',
    region: 'us-east-1',
    prefix: 'fitness/'
  }

  const storage = {
    saveFile: vi.fn(),
    getFile: vi.fn(),
    deleteFile: vi.fn(),
    getPresignedForSaveFileUrl: vi.fn(),
    verifyPresignedUpload: vi.fn()
  }

  const useStorage = (fitnessStorage?: unknown) => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      fitnessStorage
    } as unknown as ReturnType<typeof getConfig>)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.ACTIVITIES_FITNESS_STORAGE_TYPE
    vi.spyOn(LocalFileFitnessStorage, 'getStorage').mockReturnValue(
      storage as never
    )
    vi.spyOn(S3FitnessStorage, 'getStorage').mockReturnValue(storage as never)
    database.getFitnessFile.mockResolvedValue(fitnessFile)
    // vi.clearAllMocks keeps queued and persistent implementations, so drop
    // whatever a previous test set on the shared storage double.
    for (const method of Object.values(storage)) {
      method.mockReset()
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('saveFitnessFile', () => {
    const upload = { file: new File(['x'], 'run.fit') }

    it.each([
      ['local', localConfig, LocalFileFitnessStorage],
      ['s3', s3Config, S3FitnessStorage]
    ])(
      'saves through the %s backend with the configured host',
      async (_, config, backend) => {
        useStorage(config)
        storage.saveFile.mockResolvedValue({ id: 'saved' })

        await expect(saveFitnessFile(database, actor, upload)).resolves.toEqual(
          {
            id: 'saved'
          }
        )

        expect(backend.getStorage).toHaveBeenCalledWith(
          config,
          'llun.test',
          database
        )
        expect(storage.saveFile).toHaveBeenCalledWith(actor, upload)
      }
    )

    it('returns null when no fitness storage is configured', async () => {
      useStorage(undefined)

      await expect(saveFitnessFile(database, actor, upload)).resolves.toBeNull()
      expect(storage.saveFile).not.toHaveBeenCalled()
    })
  })

  describe('getFitnessFile', () => {
    it('reads the stored path from the backend', async () => {
      useStorage(localConfig)
      storage.getFile.mockResolvedValue({ type: 'buffer' })

      await expect(getFitnessFile(database, 'fitness-1')).resolves.toEqual({
        type: 'buffer'
      })
      expect(database.getFitnessFile).toHaveBeenCalledWith({ id: 'fitness-1' })
      expect(storage.getFile).toHaveBeenCalledWith('2026-01-01/run.fit')
    })

    it('does not reload metadata the caller already has', async () => {
      useStorage(s3Config)
      storage.getFile.mockResolvedValue({ type: 'redirect' })

      await getFitnessFile(database, 'fitness-1', {
        ...fitnessFile,
        path: 'other/path.fit'
      })

      expect(database.getFitnessFile).not.toHaveBeenCalled()
      expect(storage.getFile).toHaveBeenCalledWith('other/path.fit')
    })

    it('returns null for an unknown file without touching storage', async () => {
      useStorage(localConfig)
      database.getFitnessFile.mockResolvedValue(null)

      await expect(getFitnessFile(database, 'missing')).resolves.toBeNull()
      expect(storage.getFile).not.toHaveBeenCalled()
    })

    it('returns null when no fitness storage is configured', async () => {
      useStorage(undefined)

      await expect(getFitnessFile(database, 'fitness-1')).resolves.toBeNull()
    })
  })

  describe('getFitnessFileBuffer', () => {
    it('refuses to run without storage so a wrong environment is not reported as missing data', async () => {
      useStorage(undefined)

      await expect(getFitnessFileBuffer(database, 'fitness-1')).rejects.toThrow(
        'Fitness storage is not configured'
      )
    })

    it('throws when the object is missing from storage', async () => {
      useStorage(localConfig)
      storage.getFile.mockResolvedValue(null)

      await expect(getFitnessFileBuffer(database, 'fitness-1')).rejects.toThrow(
        'Fitness file not found in storage'
      )
    })

    it('returns the bytes of a buffered file', async () => {
      useStorage(localConfig)
      storage.getFile.mockResolvedValue({
        type: 'buffer',
        buffer: Buffer.from('abc'),
        contentType: 'application/vnd.ant.fit'
      })

      await expect(
        getFitnessFileBuffer(database, 'fitness-1')
      ).resolves.toEqual(Buffer.from('abc'))
    })

    it('downloads the bytes from the redirect url when storage hands one back', async () => {
      useStorage(s3Config)
      storage.getFile.mockResolvedValue({
        type: 'redirect',
        redirectUrl: 'https://bucket.example.com/signed'
      })
      const fetchMock = vi.fn().mockResolvedValue(new Response('from-s3'))
      vi.stubGlobal('fetch', fetchMock)

      const buffer = await getFitnessFileBuffer(database, 'fitness-1')

      expect(buffer.toString()).toBe('from-s3')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://bucket.example.com/signed'
      )
    })

    it('throws with the status when the redirect download fails', async () => {
      useStorage(s3Config)
      storage.getFile.mockResolvedValue({
        type: 'redirect',
        redirectUrl: 'https://bucket.example.com/signed'
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('denied', { status: 403 }))
      )

      await expect(getFitnessFileBuffer(database, 'fitness-1')).rejects.toThrow(
        'Failed to download fitness file from redirect URL (403)'
      )
    })
  })

  describe('deleteFitnessFile', () => {
    it('returns false for an unknown file without touching storage', async () => {
      useStorage(localConfig)
      database.getFitnessFile.mockResolvedValue(null)

      await expect(deleteFitnessFile(database, 'missing')).resolves.toBe(false)
      expect(storage.deleteFile).not.toHaveBeenCalled()
    })

    it('returns false and keeps the record when no fitness storage is configured', async () => {
      useStorage(undefined)

      await expect(deleteFitnessFile(database, 'fitness-1')).resolves.toBe(
        false
      )
      expect(database.deleteFitnessFile).not.toHaveBeenCalled()
    })

    it('loads the metadata itself when the caller passes none', async () => {
      useStorage(localConfig)
      storage.deleteFile.mockResolvedValue(true)
      database.deleteFitnessFile.mockResolvedValue(true)

      await expect(deleteFitnessFile(database, 'fitness-1')).resolves.toBe(true)

      expect(storage.deleteFile).toHaveBeenCalledWith('2026-01-01/run.fit')
      expect(database.deleteFitnessFile).toHaveBeenCalledWith({
        id: 'fitness-1'
      })
    })
  })

  describe('presigned uploads', () => {
    const input = {
      fileName: 'export.zip',
      contentType: 'application/zip',
      size: 10
    }

    it('are issued by the s3 backend', async () => {
      useStorage(s3Config)
      storage.getPresignedForSaveFileUrl.mockResolvedValue({
        url: 'https://bucket.example.com/signed',
        fitnessFileId: 'fitness-1'
      })

      await expect(
        getPresignedFitnessFileUrl(database, actor, input)
      ).resolves.toEqual({
        url: 'https://bucket.example.com/signed',
        fitnessFileId: 'fitness-1'
      })
      expect(storage.getPresignedForSaveFileUrl).toHaveBeenCalledWith(
        actor,
        input
      )
    })

    it.each([
      ['local storage', localConfig],
      ['unconfigured storage', undefined]
    ])('are not issued for %s', async (_, config) => {
      useStorage(config)

      await expect(
        getPresignedFitnessFileUrl(database, actor, input)
      ).resolves.toBeNull()
      expect(storage.getPresignedForSaveFileUrl).not.toHaveBeenCalled()
    })

    it('are verified by the s3 backend', async () => {
      useStorage(s3Config)
      storage.verifyPresignedUpload.mockResolvedValue(true)

      await expect(
        verifyPresignedFitnessFileUpload(database, actor, fitnessFile)
      ).resolves.toBe(true)
      expect(storage.verifyPresignedUpload).toHaveBeenCalledWith(
        actor,
        fitnessFile
      )
    })

    it.each([
      ['local storage', localConfig],
      ['unconfigured storage', undefined]
    ])('are never verified for %s', async (_, config) => {
      useStorage(config)

      await expect(
        verifyPresignedFitnessFileUpload(database, actor, fitnessFile)
      ).resolves.toBe(false)
      expect(storage.verifyPresignedUpload).not.toHaveBeenCalled()
    })
  })
})

import { getConfig } from '@/lib/config'
import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { deleteMediaFile } from '@/lib/services/medias'
import { FitnessFile } from '@/lib/types/database/fitnessFile'

import { S3FitnessStorage } from './S3StorageFile'
import { deleteFitnessFile } from './index'
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

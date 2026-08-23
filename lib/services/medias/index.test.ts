import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

import * as S3FileStorage from './S3StorageFile'
import * as mediaStorageService from './index'
import * as LocalFileStorage from './localFile'
import { MediaSchema, PresigedMediaInput } from './types'

vi.mock('@/lib/config')
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@/lib/services/medias/localFile')
vi.mock('@/lib/services/medias/S3StorageFile')

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

const HOST = 'llun.test'
const DELEGATED_RESULT = { delegated: true }

const mockDatabase = {} as unknown as Database
const actor = { id: 'actor-1' } as Actor
const file = new File(['image'], 'image.png', { type: 'image/png' })
const media = { file } as MediaSchema
const presignedInput = {
  fileName: 'image.png',
  checksum: 'a'.repeat(40),
  width: 100,
  height: 100,
  contentType: 'image/png',
  size: 1024
} as PresigedMediaInput

const createStorageMock = () => ({
  isPresigedSupported: vi.fn(),
  saveFile: vi.fn(),
  saveThumbnail: vi.fn(),
  saveImageRendition: vi.fn(),
  getPresigedForSaveFileUrl: vi.fn(),
  completePresignedUpload: vi.fn(),
  getFile: vi.fn(),
  deleteFile: vi.fn()
})
type StorageMock = ReturnType<typeof createStorageMock>

let localStorageMock: StorageMock
let s3StorageMock: StorageMock

/**
 * Every storage type an operator can configure. `saveMedia` used to omit the
 * 's3' case and silently returned null on every save — avatars, custom emojis
 * and fitness route maps all disappeared without an error — so the delegation
 * matrix below runs each exported function against all three types rather than
 * trusting one representative.
 */
const STORAGE_CONFIGS = [
  {
    description: 'local file storage',
    driver: 'local' as const,
    mediaStorage: { type: MediaStorageType.LocalFile, path: '/tmp/media' }
  },
  {
    description: 's3 storage',
    driver: 's3' as const,
    mediaStorage: {
      type: MediaStorageType.S3Storage,
      bucket: 'test-bucket',
      region: 'us-west-2'
    }
  },
  {
    description: 'object storage',
    driver: 's3' as const,
    mediaStorage: {
      type: MediaStorageType.ObjectStorage,
      bucket: 'test-bucket',
      region: 'us-east-1',
      endpoint: 'https://s3.example.com'
    }
  }
]

const ALL_STORAGE_TYPES = [
  MediaStorageType.LocalFile,
  MediaStorageType.S3Storage,
  MediaStorageType.ObjectStorage
]
const S3_STORAGE_TYPES = [
  MediaStorageType.S3Storage,
  MediaStorageType.ObjectStorage
]

// Re-exported error class and storage factory rather than a storage-delegating
// function, so they are the exports the matrix below does not describe.
const NON_DELEGATING_EXPORTS = [
  'PresignedUploadValidationError',
  'getMediaStorage'
]

interface MediaStorageFunctionCase {
  name: keyof typeof mediaStorageService
  /** Method on the resolved storage driver the function must delegate to. */
  method: keyof StorageMock
  /**
   * Arguments after `database`. Every function in this module hands these
   * straight to its driver method, so the harness both invokes the export with
   * them and asserts the driver received them. A future function that reshapes
   * its arguments fails loudly here rather than needing a silent second field.
   */
  callArguments: unknown[]
  /** Storage types the function delegates for; the rest fall back. */
  supportedTypes: MediaStorageType[]
  /** Value returned when no driver handles the configured storage type. */
  fallbackValue: null | false
}

const MEDIA_STORAGE_FUNCTIONS: MediaStorageFunctionCase[] = [
  {
    name: 'saveMedia',
    method: 'saveFile',
    callArguments: [actor, media],
    supportedTypes: ALL_STORAGE_TYPES,
    fallbackValue: null
  },
  {
    name: 'saveMediaThumbnail',
    method: 'saveThumbnail',
    callArguments: [actor, file],
    supportedTypes: ALL_STORAGE_TYPES,
    fallbackValue: null
  },
  {
    name: 'saveMediaImageRendition',
    method: 'saveImageRendition',
    callArguments: [actor, file, 'jpeg'],
    supportedTypes: ALL_STORAGE_TYPES,
    fallbackValue: null
  },
  {
    name: 'getPresignedUrl',
    method: 'getPresigedForSaveFileUrl',
    callArguments: [actor, presignedInput],
    // Presigned uploads go straight to the bucket, so local file storage has
    // nothing to sign.
    supportedTypes: S3_STORAGE_TYPES,
    fallbackValue: null
  },
  {
    name: 'completePresignedMediaUpload',
    method: 'completePresignedUpload',
    callArguments: [actor, 'media-1'],
    supportedTypes: S3_STORAGE_TYPES,
    fallbackValue: null
  },
  {
    name: 'getMedia',
    method: 'getFile',
    callArguments: ['medias/test.jpg'],
    supportedTypes: ALL_STORAGE_TYPES,
    fallbackValue: null
  },
  {
    name: 'deleteMediaFile',
    method: 'deleteFile',
    callArguments: ['medias/test.jpg'],
    supportedTypes: ALL_STORAGE_TYPES,
    fallbackValue: false
  }
]

/**
 * Invokes the live export named by the row. Looking the function up by `name`
 * rather than capturing it in a per-row closure is what keeps a copy-pasted row
 * honest: a row labelled one function cannot end up exercising another.
 */
const invoke = (mediaFunction: MediaStorageFunctionCase) => {
  const exported = mediaStorageService[mediaFunction.name] as (
    ...args: unknown[]
  ) => Promise<unknown>
  return exported(mockDatabase, ...mediaFunction.callArguments)
}

const configureStorage = (mediaStorage: unknown) => {
  mockGetConfig.mockReturnValue({
    mediaStorage,
    host: HOST
  } as unknown as ReturnType<typeof getConfig>)
}

describe('Media Storage Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    localStorageMock = createStorageMock()
    s3StorageMock = createStorageMock()

    vi.spyOn(LocalFileStorage.LocalFileStorage, 'getStorage').mockReturnValue(
      localStorageMock as unknown as ReturnType<
        typeof LocalFileStorage.LocalFileStorage.getStorage
      >
    )
    vi.spyOn(S3FileStorage.S3FileStorage, 'getStorage').mockReturnValue(
      s3StorageMock as unknown as ReturnType<
        typeof S3FileStorage.S3FileStorage.getStorage
      >
    )
  })

  // The delegation matrix below only protects what it enumerates, and an
  // `it.each([])` registers zero tests without failing, so the matrix can
  // silently shrink: exporting an eighth function, dropping a STORAGE_CONFIGS
  // entry, or adding a fourth MediaStorageType would each leave a green suite
  // that no longer covers the case this file exists to catch.
  describe('matrix coverage', () => {
    it('describes every function exported from the module', () => {
      const exported = Object.keys(mediaStorageService).filter(
        (name) => !NON_DELEGATING_EXPORTS.includes(name)
      )

      expect(exported.sort()).toEqual(
        MEDIA_STORAGE_FUNCTIONS.map(
          (mediaFunction) => mediaFunction.name
        ).sort()
      )
    })

    it('exercises every configurable storage type', () => {
      const exercised = STORAGE_CONFIGS.map(
        (storage) => storage.mediaStorage.type
      )

      expect(exercised.sort()).toEqual(Object.values(MediaStorageType).sort())
    })

    // Without this, a new enum member is auto-classified as unsupported: adding
    // it to STORAGE_CONFIGS alone turns the previous guard green again while
    // every function merely asserts that returning null for it is correct —
    // which is precisely the silent-null bug this file exists to catch.
    it('treats every configurable storage type as supported by default', () => {
      expect([...ALL_STORAGE_TYPES].sort()).toEqual(
        Object.values(MediaStorageType).sort()
      )
    })
  })

  describe.each(MEDIA_STORAGE_FUNCTIONS)('$name', (mediaFunction) => {
    const supported = STORAGE_CONFIGS.filter((storage) =>
      mediaFunction.supportedTypes.includes(storage.mediaStorage.type)
    )
    const unsupported = STORAGE_CONFIGS.filter(
      (storage) =>
        !mediaFunction.supportedTypes.includes(storage.mediaStorage.type)
    )

    it.each(supported)('delegates to $description', async (storage) => {
      configureStorage(storage.mediaStorage)
      const [expectedStorage, otherStorage] =
        storage.driver === 'local'
          ? [localStorageMock, s3StorageMock]
          : [s3StorageMock, localStorageMock]
      const expectedGetStorage =
        storage.driver === 'local'
          ? LocalFileStorage.LocalFileStorage.getStorage
          : S3FileStorage.S3FileStorage.getStorage
      expectedStorage[mediaFunction.method].mockResolvedValue(DELEGATED_RESULT)

      const result = await invoke(mediaFunction)

      expect(result).toBe(DELEGATED_RESULT)
      expect(expectedGetStorage).toHaveBeenCalledWith(
        storage.mediaStorage,
        HOST,
        mockDatabase
      )
      expect(expectedStorage[mediaFunction.method]).toHaveBeenCalledWith(
        ...mediaFunction.callArguments
      )
      expect(otherStorage[mediaFunction.method]).not.toHaveBeenCalled()
    })

    if (unsupported.length > 0) {
      it.each(unsupported)(
        'returns the fallback value for $description',
        async (storage) => {
          configureStorage(storage.mediaStorage)

          const result = await invoke(mediaFunction)

          expect(result).toBe(mediaFunction.fallbackValue)
          expect(localStorageMock[mediaFunction.method]).not.toHaveBeenCalled()
          expect(s3StorageMock[mediaFunction.method]).not.toHaveBeenCalled()
        }
      )
    }

    it('returns the fallback value when no storage is configured', async () => {
      configureStorage(undefined)

      const result = await invoke(mediaFunction)

      expect(result).toBe(mediaFunction.fallbackValue)
      expect(localStorageMock[mediaFunction.method]).not.toHaveBeenCalled()
      expect(s3StorageMock[mediaFunction.method]).not.toHaveBeenCalled()
    })
  })

  describe('deleteMediaFile', () => {
    beforeEach(() => {
      configureStorage({ type: MediaStorageType.LocalFile, path: '/tmp/media' })
    })

    it('returns false when the driver reports the deletion failed', async () => {
      localStorageMock.deleteFile.mockResolvedValue(false)

      const result = await mediaStorageService.deleteMediaFile(
        mockDatabase,
        'medias/test.jpg'
      )

      expect(result).toBe(false)
      // Without this the assertion above cannot tell a driver that returned
      // false from the `default` branch, which returns false too.
      expect(localStorageMock.deleteFile).toHaveBeenCalledWith(
        'medias/test.jpg'
      )
    })

    it('passes the path through unchanged', async () => {
      localStorageMock.deleteFile.mockResolvedValue(true)

      await mediaStorageService.deleteMediaFile(
        mockDatabase,
        'medias/file with spaces.jpg'
      )

      expect(localStorageMock.deleteFile).toHaveBeenCalledWith(
        'medias/file with spaces.jpg'
      )
    })
  })
})

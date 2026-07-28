import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

import * as S3FileStorage from './S3StorageFile'
import {
  completePresignedMediaUpload,
  deleteMediaFile,
  getMedia,
  getPresignedUrl,
  saveMedia,
  saveMediaImageRendition,
  saveMediaThumbnail
} from './index'
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

interface MediaStorageFunctionCase {
  name: string
  /** Method on the resolved storage driver the function must delegate to. */
  method: keyof StorageMock
  expectedArguments: unknown[]
  /** Storage types the function delegates for; the rest fall back. */
  supportedTypes: MediaStorageType[]
  /** Value returned when no driver handles the configured storage type. */
  fallbackValue: null | false
  call: () => Promise<unknown>
}

const MEDIA_STORAGE_FUNCTIONS: MediaStorageFunctionCase[] = [
  {
    name: 'saveMedia',
    method: 'saveFile',
    expectedArguments: [actor, media],
    supportedTypes: ALL_STORAGE_TYPES,
    fallbackValue: null,
    call: () => saveMedia(mockDatabase, actor, media)
  },
  {
    name: 'saveMediaThumbnail',
    method: 'saveThumbnail',
    expectedArguments: [actor, file],
    supportedTypes: ALL_STORAGE_TYPES,
    fallbackValue: null,
    call: () => saveMediaThumbnail(mockDatabase, actor, file)
  },
  {
    name: 'saveMediaImageRendition',
    method: 'saveImageRendition',
    expectedArguments: [actor, file, 'jpeg'],
    supportedTypes: ALL_STORAGE_TYPES,
    fallbackValue: null,
    call: () => saveMediaImageRendition(mockDatabase, actor, file, 'jpeg')
  },
  {
    name: 'getPresignedUrl',
    method: 'getPresigedForSaveFileUrl',
    expectedArguments: [actor, presignedInput],
    // Presigned uploads go straight to the bucket, so local file storage has
    // nothing to sign.
    supportedTypes: S3_STORAGE_TYPES,
    fallbackValue: null,
    call: () => getPresignedUrl(mockDatabase, actor, presignedInput)
  },
  {
    name: 'completePresignedMediaUpload',
    method: 'completePresignedUpload',
    expectedArguments: [actor, 'media-1'],
    supportedTypes: S3_STORAGE_TYPES,
    fallbackValue: null,
    call: () => completePresignedMediaUpload(mockDatabase, actor, 'media-1')
  },
  {
    name: 'getMedia',
    method: 'getFile',
    expectedArguments: ['medias/test.jpg'],
    supportedTypes: ALL_STORAGE_TYPES,
    fallbackValue: null,
    call: () => getMedia(mockDatabase, 'medias/test.jpg')
  },
  {
    name: 'deleteMediaFile',
    method: 'deleteFile',
    expectedArguments: ['medias/test.jpg'],
    supportedTypes: ALL_STORAGE_TYPES,
    fallbackValue: false,
    call: () => deleteMediaFile(mockDatabase, 'medias/test.jpg')
  }
]

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

      const result = await mediaFunction.call()

      expect(result).toBe(DELEGATED_RESULT)
      expect(expectedGetStorage).toHaveBeenCalledWith(
        storage.mediaStorage,
        HOST,
        mockDatabase
      )
      expect(expectedStorage[mediaFunction.method]).toHaveBeenCalledWith(
        ...mediaFunction.expectedArguments
      )
      expect(otherStorage[mediaFunction.method]).not.toHaveBeenCalled()
    })

    if (unsupported.length > 0) {
      it.each(unsupported)(
        'returns the fallback value for $description',
        async (storage) => {
          configureStorage(storage.mediaStorage)

          const result = await mediaFunction.call()

          expect(result).toBe(mediaFunction.fallbackValue)
          expect(localStorageMock[mediaFunction.method]).not.toHaveBeenCalled()
          expect(s3StorageMock[mediaFunction.method]).not.toHaveBeenCalled()
        }
      )
    }

    it('returns the fallback value when no storage is configured', async () => {
      configureStorage(undefined)

      const result = await mediaFunction.call()

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

      const result = await deleteMediaFile(mockDatabase, 'medias/test.jpg')

      expect(result).toBe(false)
    })

    it('passes the path through unchanged', async () => {
      localStorageMock.deleteFile.mockResolvedValue(true)

      await deleteMediaFile(mockDatabase, 'medias/file with spaces.jpg')

      expect(localStorageMock.deleteFile).toHaveBeenCalledWith(
        'medias/file with spaces.jpg'
      )
    })
  })
})

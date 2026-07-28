import { logger } from '@/lib/utils/logger'

import {
  MediaStorageFileConfig,
  MediaStorageS3Config,
  MediaStorageType,
  getMediaStorageConfig
} from './mediaStorage'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: vi.fn()
  }
}))

describe('MediaStorage config', () => {
  const originalEnv = process.env
  const mockWarn = logger.warn as jest.Mock

  beforeEach(() => {
    process.env = { ...originalEnv }
    mockWarn.mockReset()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('MediaStorageFileConfig schema', () => {
    it('parses fs config', () => {
      const config = MediaStorageFileConfig.parse({
        type: 'fs',
        path: '/uploads',
        maxFileSize: 1000
      })

      expect(config.type).toBe('fs')
      expect(config.path).toBe('/uploads')
    })

    it('parses fs config with quota', () => {
      const config = MediaStorageFileConfig.parse({
        type: 'fs',
        path: '/uploads',
        maxFileSize: 1000,
        quotaPerAccount: 500_000_000
      })

      expect(config.type).toBe('fs')
      expect(config.quotaPerAccount).toBe(500_000_000)
    })
  })

  describe('MediaStorageS3Config schema', () => {
    it('parses s3 config', () => {
      const config = MediaStorageS3Config.parse({
        type: 's3',
        bucket: 'my-bucket',
        region: 'us-west-2'
      })

      expect(config.type).toBe('s3')
      expect(config.bucket).toBe('my-bucket')
    })

    it('parses object storage config', () => {
      const config = MediaStorageS3Config.parse({
        type: 'object',
        bucket: 'my-bucket',
        region: 'auto',
        hostname: 'media-cdn.example.com',
        endpoint: 'https://custom.endpoint.com'
      })

      expect(config.type).toBe('object')
      expect(config.hostname).toBe('media-cdn.example.com')
      expect(config.endpoint).toBe('https://custom.endpoint.com')
    })
  })

  describe('getMediaStorageConfig', () => {
    it('returns null when no media storage env vars', () => {
      const config = getMediaStorageConfig()
      expect(config).toBeNull()
    })

    it('builds fs config from env vars', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_MEDIA_STORAGE_PATH = '/data/uploads'

      const config = getMediaStorageConfig()

      expect(config).not.toBeNull()
      expect(config?.mediaStorage.type).toBe(MediaStorageType.LocalFile)
      expect((config?.mediaStorage as { path: string }).path).toBe(
        '/data/uploads'
      )
    })

    it('builds fs config with custom max file size', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_MEDIA_STORAGE_PATH = '/data/uploads'
      process.env.ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE = '5000000'

      const config = getMediaStorageConfig()

      expect(config?.mediaStorage.maxFileSize).toBe(5000000)
    })

    it('builds fs config with quota per account', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_MEDIA_STORAGE_PATH = '/data/uploads'
      process.env.ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT = '750000000'

      const config = getMediaStorageConfig()

      expect(config?.mediaStorage.quotaPerAccount).toBe(750000000)
    })

    it('builds s3 config from env vars', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 's3'
      process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = 'test-bucket'
      process.env.ACTIVITIES_MEDIA_STORAGE_REGION = 'us-east-1'

      const config = getMediaStorageConfig()

      expect(config).not.toBeNull()
      expect(config?.mediaStorage.type).toBe(MediaStorageType.S3Storage)
      expect((config?.mediaStorage as { bucket: string }).bucket).toBe(
        'test-bucket'
      )
    })

    it('builds object storage config with public hostname and endpoint', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'object'
      process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = 'bucket'
      process.env.ACTIVITIES_MEDIA_STORAGE_REGION = 'auto'
      process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = 'media-cdn.example.com'
      process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT =
        'https://storage.example.com'

      const config = getMediaStorageConfig()

      expect(config?.mediaStorage.type).toBe(MediaStorageType.ObjectStorage)
      expect((config?.mediaStorage as { hostname: string }).hostname).toBe(
        'media-cdn.example.com'
      )
      expect((config?.mediaStorage as { endpoint: string }).endpoint).toBe(
        'https://storage.example.com'
      )
    })

    it('returns null for unknown storage type', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'unknown'

      const config = getMediaStorageConfig()

      expect(config).toBeNull()
    })

    // A set-but-blank required value used to satisfy `z.string()` and boot a
    // live-but-broken backend: `path.resolve('')` is the process CWD, so
    // uploads landed in the application directory and /api/v1/files served it.
    // Whitespace is truthy, so it slipped past every existing falsy check.
    it.each([
      {
        description: 'the fs path is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs',
          ACTIVITIES_MEDIA_STORAGE_PATH: ''
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_PATH'
      },
      {
        description: 'the fs path is whitespace only',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs',
          ACTIVITIES_MEDIA_STORAGE_PATH: '   '
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_PATH'
      },
      {
        description: 'the s3 bucket is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
      },
      {
        description: 'the s3 bucket is whitespace only',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '  ',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
      },
      {
        description: 'the s3 region is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'test-bucket',
          ACTIVITIES_MEDIA_STORAGE_REGION: ''
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_REGION'
      },
      {
        description: 'the s3 region is whitespace only',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'test-bucket',
          ACTIVITIES_MEDIA_STORAGE_REGION: '\t'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_REGION'
      },
      {
        description: 'the object storage bucket is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'auto'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
      }
    ])('returns null when $description', ({ env, warnedVariable }) => {
      Object.assign(process.env, env)

      expect(getMediaStorageConfig()).toBeNull()
      expect(mockWarn).toHaveBeenCalledWith(
        `${warnedVariable} is set but empty; media storage will be disabled`
      )
    })

    it('trims a padded fs path instead of rejecting it', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_MEDIA_STORAGE_PATH = '  /data/uploads  '

      const config = getMediaStorageConfig()

      expect((config?.mediaStorage as { path: string }).path).toBe(
        '/data/uploads'
      )
      expect(mockWarn).not.toHaveBeenCalled()
    })

    it('trims a padded bucket and region instead of rejecting them', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 's3'
      process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = ' test-bucket '
      process.env.ACTIVITIES_MEDIA_STORAGE_REGION = ' us-east-1\n'

      const config = getMediaStorageConfig()

      expect((config?.mediaStorage as { bucket: string }).bucket).toBe(
        'test-bucket'
      )
      expect((config?.mediaStorage as { region: string }).region).toBe(
        'us-east-1'
      )
      expect(mockWarn).not.toHaveBeenCalled()
    })

    // Unset must keep failing loudly in `Config.parse` rather than quietly
    // disabling storage — only blank changed behaviour.
    it('leaves an unset required value undefined for schema validation', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'fs'
      delete process.env.ACTIVITIES_MEDIA_STORAGE_PATH

      const config = getMediaStorageConfig()

      expect(config).not.toBeNull()
      expect((config?.mediaStorage as { path?: string }).path).toBeUndefined()
      expect(() => MediaStorageFileConfig.parse(config?.mediaStorage)).toThrow()
      expect(mockWarn).not.toHaveBeenCalled()
    })
  })
})

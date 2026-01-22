import {
  MediaStorageFileConfig,
  MediaStorageS3Config,
  MediaStorageType,
  getMediaStorageConfig
} from './mediaStorage'

describe('MediaStorage config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
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
        hostname: 'custom.endpoint.com'
      })

      expect(config.type).toBe('object')
      expect(config.hostname).toBe('custom.endpoint.com')
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

    it('builds object storage config with hostname', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'object'
      process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = 'bucket'
      process.env.ACTIVITIES_MEDIA_STORAGE_REGION = 'auto'
      process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = 'storage.example.com'

      const config = getMediaStorageConfig()

      expect(config?.mediaStorage.type).toBe(MediaStorageType.ObjectStorage)
      expect((config?.mediaStorage as { hostname: string }).hostname).toBe(
        'storage.example.com'
      )
    })

    it('returns null for unknown storage type', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'unknown'

      const config = getMediaStorageConfig()

      expect(config).toBeNull()
    })
  })
})

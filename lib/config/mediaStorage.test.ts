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
    // `matcher('ACTIVITIES_MEDIA_STORAGE_')` keys off ANY variable with that
    // prefix, and the documented local workflow exports .env.local into the
    // shell — so a developer's own storage config would otherwise decide which
    // branch these tests take.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ACTIVITIES_MEDIA_STORAGE_')) delete process.env[key]
    }
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
        description: 'returns null when the fs path is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs',
          ACTIVITIES_MEDIA_STORAGE_PATH: ''
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_PATH'
      },
      {
        description: 'returns null when the fs path is whitespace only',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs',
          ACTIVITIES_MEDIA_STORAGE_PATH: '   '
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_PATH'
      },
      {
        description: 'returns null when the s3 bucket is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
      },
      {
        description: 'returns null when the s3 bucket is whitespace only',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '  ',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
      },
      {
        description: 'returns null when the s3 region is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'test-bucket',
          ACTIVITIES_MEDIA_STORAGE_REGION: ''
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_REGION'
      },
      {
        description: 'returns null when the s3 region is whitespace only',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'test-bucket',
          ACTIVITIES_MEDIA_STORAGE_REGION: '\t'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_REGION'
      },
      {
        description: 'returns null when the object storage bucket is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'auto'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
      }
    ])('$description', ({ env, warnedVariable }) => {
      Object.assign(process.env, env)

      expect(getMediaStorageConfig()).toBeNull()
      expect(mockWarn).toHaveBeenCalledWith(
        `${warnedVariable} is set but empty; media storage will be disabled`
      )
      expect(mockWarn).toHaveBeenCalledTimes(1)
    })

    // Both values are read before either is checked, so an operator with two
    // blank variables sees both names instead of fixing them one boot at a
    // time. Short-circuiting on the first would still pass every row above.
    it('warns for every blank required value before disabling storage', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 's3'
      process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = ''
      process.env.ACTIVITIES_MEDIA_STORAGE_REGION = '  '

      expect(getMediaStorageConfig()).toBeNull()
      expect(mockWarn).toHaveBeenCalledTimes(2)
      expect(mockWarn).toHaveBeenCalledWith(
        'ACTIVITIES_MEDIA_STORAGE_BUCKET is set but empty; media storage will be disabled'
      )
      expect(mockWarn).toHaveBeenCalledWith(
        'ACTIVITIES_MEDIA_STORAGE_REGION is set but empty; media storage will be disabled'
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
    // disabling storage — only blank changed behaviour. Relaxing any guard's
    // `=== null` to `== null` would swap one for the other, and without these
    // the whole suite still passes.
    it.each([
      {
        description: 'leaves an unset fs path undefined for schema validation',
        env: { ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs' },
        unset: 'ACTIVITIES_MEDIA_STORAGE_PATH',
        schema: MediaStorageFileConfig,
        field: 'path'
      },
      {
        description:
          'leaves an unset s3 bucket undefined for schema validation',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1'
        },
        unset: 'ACTIVITIES_MEDIA_STORAGE_BUCKET',
        schema: MediaStorageS3Config,
        field: 'bucket'
      },
      {
        description:
          'leaves an unset s3 region undefined for schema validation',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'test-bucket'
        },
        unset: 'ACTIVITIES_MEDIA_STORAGE_REGION',
        schema: MediaStorageS3Config,
        field: 'region'
      }
    ])('$description', ({ env, unset, schema, field }) => {
      Object.assign(process.env, env)
      delete process.env[unset]

      const config = getMediaStorageConfig()

      expect(config).not.toBeNull()
      expect(
        (config?.mediaStorage as Record<string, unknown>)[field]
      ).toBeUndefined()
      expect(mockWarn).not.toHaveBeenCalled()

      // Name the failing field: a bare `.toThrow()` also passes when some
      // unrelated field is what Zod rejected.
      const result = schema.safeParse(config?.mediaStorage)
      expect(result.success).toBe(false)
      expect(
        result.error?.issues.map((issue) => issue.path.join('.'))
      ).toContain(field)
    })
  })
})

import path from 'path'

import { logger } from '@/lib/utils/logger'

import {
  DEFAULT_FITNESS_MAX_FILE_SIZE,
  FitnessStorageType,
  getFitnessStorageConfig
} from './fitnessStorage'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: vi.fn()
  }
}))

describe('FitnessStorage config', () => {
  const originalEnv = process.env
  const mockWarn = logger.warn as jest.Mock

  beforeEach(() => {
    process.env = { ...originalEnv }
    mockWarn.mockReset()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('getFitnessStorageConfig', () => {
    it('returns null when no fitness or media storage env vars are set', () => {
      const config = getFitnessStorageConfig()
      expect(config).toBeNull()
    })

    it('falls back to media local storage when fitness type is unset', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_MEDIA_STORAGE_PATH = 'uploads/'
      process.env.ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT = '5000000'
      process.env.ACTIVITIES_FITNESS_STORAGE_MAX_FILE_SIZE = '12345'

      const config = getFitnessStorageConfig()

      expect(config?.fitnessStorage.type).toBe(FitnessStorageType.LocalFile)
      expect((config?.fitnessStorage as { path: string }).path).toBe(
        path.join('uploads/', 'fitness')
      )
      expect(config?.fitnessStorage.maxFileSize).toBe(12345)
      expect(config?.fitnessStorage.quotaPerAccount).toBe(5000000)
    })

    it('still falls back to media config when only fitness tuning vars are set', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'object'
      process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = 'bucket'
      process.env.ACTIVITIES_MEDIA_STORAGE_REGION = 'auto'
      process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = 'media-cdn.example.com'
      process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT =
        'https://storage.example.com'
      process.env.ACTIVITIES_FITNESS_STORAGE_QUOTA_PER_ACCOUNT = '2000000'

      const config = getFitnessStorageConfig()

      expect(config?.fitnessStorage.type).toBe(FitnessStorageType.ObjectStorage)
      expect((config?.fitnessStorage as { prefix: string }).prefix).toBe(
        'fitness/'
      )
      expect((config?.fitnessStorage as { hostname: string }).hostname).toBe(
        'media-cdn.example.com'
      )
      expect((config?.fitnessStorage as { endpoint: string }).endpoint).toBe(
        'https://storage.example.com'
      )
      expect(config?.fitnessStorage.maxFileSize).toBe(
        DEFAULT_FITNESS_MAX_FILE_SIZE
      )
    })

    it('uses explicit fitness object storage endpoint separately from public hostname', () => {
      process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'object'
      process.env.ACTIVITIES_FITNESS_STORAGE_BUCKET = 'fitness-bucket'
      process.env.ACTIVITIES_FITNESS_STORAGE_REGION = 'auto'
      process.env.ACTIVITIES_FITNESS_STORAGE_HOSTNAME =
        'fitness-cdn.example.com'
      process.env.ACTIVITIES_FITNESS_STORAGE_ENDPOINT =
        'https://fitness-storage.example.com'

      const config = getFitnessStorageConfig()

      expect(config?.fitnessStorage.type).toBe(FitnessStorageType.ObjectStorage)
      expect((config?.fitnessStorage as { hostname: string }).hostname).toBe(
        'fitness-cdn.example.com'
      )
      expect((config?.fitnessStorage as { endpoint: string }).endpoint).toBe(
        'https://fitness-storage.example.com'
      )
    })

    it('uses explicit fitness storage config when fitness type is set', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_MEDIA_STORAGE_PATH = '/media/uploads'
      process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_FITNESS_STORAGE_PATH = '/fitness/uploads'
      process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = ' mapbox-token '

      const config = getFitnessStorageConfig()

      expect(config?.fitnessStorage.type).toBe(FitnessStorageType.LocalFile)
      expect((config?.fitnessStorage as { path: string }).path).toBe(
        '/fitness/uploads'
      )
      expect(config?.fitnessStorage.mapboxAccessToken).toBe('mapbox-token')
    })

    it('returns null for unknown fitness storage type', () => {
      process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'unknown'

      const config = getFitnessStorageConfig()

      expect(config).toBeNull()
    })

    // Both branches read required values raw. A blank fitness path hit the same
    // `path.resolve('')` as the media one, and in the fallback branch a blank
    // media path slipped through `|| 'uploads'` into `uploads/fitness` under
    // the process CWD. Whitespace is truthy, so it survived those checks too.
    it.each([
      {
        description: 'the fitness fs path is empty',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 'fs',
          ACTIVITIES_FITNESS_STORAGE_PATH: ''
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_PATH'
      },
      {
        description: 'the fitness fs path is whitespace only',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 'fs',
          ACTIVITIES_FITNESS_STORAGE_PATH: '   '
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_PATH'
      },
      {
        description: 'the fitness s3 bucket is empty',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: '',
          ACTIVITIES_FITNESS_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_BUCKET'
      },
      {
        description: 'the fitness s3 bucket is whitespace only',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: '  ',
          ACTIVITIES_FITNESS_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_BUCKET'
      },
      {
        description: 'the fitness s3 region is empty',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-bucket',
          ACTIVITIES_FITNESS_STORAGE_REGION: ''
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_REGION'
      },
      {
        description: 'the fitness object storage region is whitespace only',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 'object',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-bucket',
          ACTIVITIES_FITNESS_STORAGE_REGION: '\t'
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_REGION'
      },
      {
        description: 'the fallback media fs path is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs',
          ACTIVITIES_MEDIA_STORAGE_PATH: ''
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_PATH'
      },
      {
        description: 'the fallback media fs path is whitespace only',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs',
          ACTIVITIES_MEDIA_STORAGE_PATH: '   '
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_PATH'
      },
      {
        description: 'the fallback media s3 bucket is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
      },
      {
        description: 'the fallback media s3 bucket is whitespace only',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '  ',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
      },
      {
        description: 'the fallback media object storage region is empty',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'bucket',
          ACTIVITIES_MEDIA_STORAGE_REGION: ''
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_REGION'
      },
      {
        description:
          'the fallback media object storage region is whitespace only',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'bucket',
          ACTIVITIES_MEDIA_STORAGE_REGION: '\t'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_REGION'
      }
    ])('returns null when $description', ({ env, warnedVariable }) => {
      Object.assign(process.env, env)

      expect(getFitnessStorageConfig()).toBeNull()
      expect(mockWarn).toHaveBeenCalledWith(
        `${warnedVariable} is set but empty; fitness storage will be disabled`
      )
    })

    it('trims a padded fitness path instead of rejecting it', () => {
      process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_FITNESS_STORAGE_PATH = '  /fitness/uploads  '

      const config = getFitnessStorageConfig()

      expect((config?.fitnessStorage as { path: string }).path).toBe(
        '/fitness/uploads'
      )
      expect(mockWarn).not.toHaveBeenCalled()
    })

    it('trims a padded fitness bucket and region instead of rejecting them', () => {
      process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 's3'
      process.env.ACTIVITIES_FITNESS_STORAGE_BUCKET = ' fitness-bucket '
      process.env.ACTIVITIES_FITNESS_STORAGE_REGION = '\tus-east-1 '

      const config = getFitnessStorageConfig()

      expect((config?.fitnessStorage as { bucket: string }).bucket).toBe(
        'fitness-bucket'
      )
      expect((config?.fitnessStorage as { region: string }).region).toBe(
        'us-east-1'
      )
      expect(mockWarn).not.toHaveBeenCalled()
    })

    it('trims the padded fallback media path before appending fitness', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_MEDIA_STORAGE_PATH = '  /data/uploads  '

      const config = getFitnessStorageConfig()

      expect((config?.fitnessStorage as { path: string }).path).toBe(
        path.join('/data/uploads', 'fitness')
      )
      expect(mockWarn).not.toHaveBeenCalled()
    })

    // An unset fallback media path keeps its historical `uploads` default; only
    // a blank one is now treated as unconfigured.
    it('keeps the uploads default when the fallback media path is unset', () => {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 'fs'
      delete process.env.ACTIVITIES_MEDIA_STORAGE_PATH

      const config = getFitnessStorageConfig()

      expect((config?.fitnessStorage as { path: string }).path).toBe(
        path.join('uploads', 'fitness')
      )
      expect(mockWarn).not.toHaveBeenCalled()
    })

    // Unset must keep failing loudly in `Config.parse`, not disable storage.
    it('leaves an unset fitness path undefined for schema validation', () => {
      process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'fs'
      delete process.env.ACTIVITIES_FITNESS_STORAGE_PATH

      const config = getFitnessStorageConfig()

      expect(config).not.toBeNull()
      expect((config?.fitnessStorage as { path?: string }).path).toBeUndefined()
      expect(mockWarn).not.toHaveBeenCalled()
    })
  })
})

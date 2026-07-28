import path from 'path'

import {
  DEFAULT_FITNESS_MAX_FILE_SIZE,
  FitnessStorageType,
  getFitnessStorageConfig
} from './fitnessStorage'

describe('FitnessStorage config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('getFitnessStorageConfig', () => {
    // Fitness storage falls back to the SAME ACTIVITIES_MEDIA_STORAGE_*
    // variables, so it needs the same blank guard. A blank path used to fall
    // through to `|| 'uploads'` and resolve relative to the process CWD,
    // rooting .fit/.gpx uploads inside the application directory while the
    // admin UI reported media storage as not configured; a blank bucket booted
    // a live-but-broken S3 backend that failed at request time.
    it.each([
      {
        name: 'a blank filesystem path',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs',
          ACTIVITIES_MEDIA_STORAGE_PATH: ''
        }
      },
      {
        name: 'a whitespace-only filesystem path',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs',
          ACTIVITIES_MEDIA_STORAGE_PATH: '   '
        }
      },
      {
        name: 'a blank bucket',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'eu-central-1'
        }
      },
      {
        name: 'a blank region',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media.example.social',
          ACTIVITIES_MEDIA_STORAGE_REGION: ''
        }
      }
    ])(
      'refuses to fall back to media storage configured with $name',
      ({ env }) => {
        Object.assign(process.env, env)
        expect(getFitnessStorageConfig()).toBeNull()
      }
    )

    // The same guard on fitness's own variables. These reach the identical
    // path.resolve('') in LocalFileFitnessStorage, so a blank one roots
    // .fit/.gpx uploads at the process CWD exactly as the media path did.
    it.each([
      {
        name: 'a blank path',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 'fs',
          ACTIVITIES_FITNESS_STORAGE_PATH: ''
        }
      },
      {
        name: 'a whitespace-only path',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 'fs',
          ACTIVITIES_FITNESS_STORAGE_PATH: '   '
        }
      },
      {
        name: 'a blank bucket',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: '',
          ACTIVITIES_FITNESS_STORAGE_REGION: 'eu-central-1'
        }
      },
      {
        name: 'a blank region',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness.example.social',
          ACTIVITIES_FITNESS_STORAGE_REGION: ''
        }
      }
    ])('refuses its own storage variables configured with $name', ({ env }) => {
      Object.assign(process.env, env)
      expect(getFitnessStorageConfig()).toBeNull()
    })

    it('trims a padded path on its own variables', () => {
      process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_FITNESS_STORAGE_PATH = '  /data/fitness  '

      expect(getFitnessStorageConfig()?.fitnessStorage).toMatchObject({
        type: 'fs',
        path: '/data/fitness'
      })
    })

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
  })
})

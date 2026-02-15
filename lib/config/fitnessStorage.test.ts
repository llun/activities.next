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
      process.env.ACTIVITIES_FITNESS_STORAGE_QUOTA_PER_ACCOUNT = '2000000'

      const config = getFitnessStorageConfig()

      expect(config?.fitnessStorage.type).toBe(FitnessStorageType.ObjectStorage)
      expect((config?.fitnessStorage as { prefix: string }).prefix).toBe(
        'fitness/'
      )
      expect(config?.fitnessStorage.maxFileSize).toBe(
        DEFAULT_FITNESS_MAX_FILE_SIZE
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

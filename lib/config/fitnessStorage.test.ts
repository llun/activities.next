import path from 'path'

import { logger } from '@/lib/utils/logger'

import {
  DEFAULT_FITNESS_MAX_FILE_SIZE,
  FitnessStorageFileConfig,
  FitnessStorageS3Config,
  FitnessStorageType,
  getFitnessStorageConfig,
  getMediaReservedFitnessPathPrefixes,
  hasExplicitFitnessStorageType
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
    // Both prefixes decide which branch this resolver takes, and the documented
    // local workflow exports .env.local into the shell — without this, a
    // developer's own storage config silently changes what these tests assert.
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith('ACTIVITIES_MEDIA_STORAGE_') ||
        key.startsWith('ACTIVITIES_FITNESS_')
      ) {
        delete process.env[key]
      }
    }
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
        description: 'blank fitness path disables storage',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 'fs',
          ACTIVITIES_FITNESS_STORAGE_PATH: ''
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_PATH'
      },
      {
        description: 'whitespace fitness path disables storage',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 'fs',
          ACTIVITIES_FITNESS_STORAGE_PATH: '   '
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_PATH'
      },
      {
        description: 'blank fitness bucket disables storage',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: '',
          ACTIVITIES_FITNESS_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_BUCKET'
      },
      {
        description: 'whitespace fitness bucket disables storage',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: '  ',
          ACTIVITIES_FITNESS_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_BUCKET'
      },
      {
        description: 'blank fitness region disables storage',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-bucket',
          ACTIVITIES_FITNESS_STORAGE_REGION: ''
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_REGION'
      },
      {
        description: 'whitespace fitness region disables storage',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 'object',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-bucket',
          ACTIVITIES_FITNESS_STORAGE_REGION: '\t'
        },
        warnedVariable: 'ACTIVITIES_FITNESS_STORAGE_REGION'
      },
      {
        description: 'blank fallback path disables storage',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs',
          ACTIVITIES_MEDIA_STORAGE_PATH: ''
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_PATH'
      },
      {
        description: 'whitespace fallback path disables storage',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'fs',
          ACTIVITIES_MEDIA_STORAGE_PATH: '   '
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_PATH'
      },
      {
        description: 'blank fallback bucket disables storage',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
      },
      {
        description: 'whitespace fallback bucket disables storage',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '  ',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
      },
      {
        description: 'blank fallback region disables storage',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'bucket',
          ACTIVITIES_MEDIA_STORAGE_REGION: ''
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_REGION'
      },
      {
        description: 'whitespace fallback region disables storage',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'bucket',
          ACTIVITIES_MEDIA_STORAGE_REGION: '\t'
        },
        warnedVariable: 'ACTIVITIES_MEDIA_STORAGE_REGION'
      }
    ])('$description', ({ env, warnedVariable }) => {
      Object.assign(process.env, env)

      expect(getFitnessStorageConfig()).toBeNull()
      expect(mockWarn).toHaveBeenCalledWith(
        `${warnedVariable} is set but empty; fitness storage will be disabled`
      )
      expect(mockWarn).toHaveBeenCalledTimes(1)
    })

    // Once per branch: the explicit switch and the media fallback each read
    // both values before checking either, and short-circuiting one of them
    // still passes every single-blank row above.
    it.each([
      {
        description: 'explicit branch warns for both blank values',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 'object',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: '',
          ACTIVITIES_FITNESS_STORAGE_REGION: '  '
        },
        variables: [
          'ACTIVITIES_FITNESS_STORAGE_BUCKET',
          'ACTIVITIES_FITNESS_STORAGE_REGION'
        ]
      },
      {
        description: 'fallback branch warns for both blank values',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: '',
          ACTIVITIES_MEDIA_STORAGE_REGION: '  '
        },
        variables: [
          'ACTIVITIES_MEDIA_STORAGE_BUCKET',
          'ACTIVITIES_MEDIA_STORAGE_REGION'
        ]
      }
    ])('$description', ({ env, variables }) => {
      Object.assign(process.env, env)

      expect(getFitnessStorageConfig()).toBeNull()
      expect(mockWarn).toHaveBeenCalledTimes(2)
      for (const variable of variables) {
        expect(mockWarn).toHaveBeenCalledWith(
          `${variable} is set but empty; fitness storage will be disabled`
        )
      }
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

    // Preserves the historical `uploads` default for an unset media path; only
    // a blank one is now treated as unconfigured. A booting app cannot reach
    // this — `getMediaStorageConfig()` yields `{path: undefined}` and
    // `Config.parse` throws first — so this pins the resolver in isolation.
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
    // Without these, relaxing a guard's `=== null` to `== null` passes.
    it.each([
      {
        description:
          'leaves an unset fitness path undefined for schema validation',
        env: { ACTIVITIES_FITNESS_STORAGE_TYPE: 'fs' },
        unset: 'ACTIVITIES_FITNESS_STORAGE_PATH',
        schema: FitnessStorageFileConfig,
        field: 'path'
      },
      {
        description:
          'leaves an unset fitness bucket undefined for schema validation',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
          ACTIVITIES_FITNESS_STORAGE_REGION: 'us-east-1'
        },
        unset: 'ACTIVITIES_FITNESS_STORAGE_BUCKET',
        schema: FitnessStorageS3Config,
        field: 'bucket'
      },
      {
        description:
          'leaves an unset fitness region undefined for schema validation',
        env: {
          ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
          ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-bucket'
        },
        unset: 'ACTIVITIES_FITNESS_STORAGE_REGION',
        schema: FitnessStorageS3Config,
        field: 'region'
      },
      {
        description:
          'leaves an unset fallback media bucket undefined for schema validation',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1'
        },
        unset: 'ACTIVITIES_MEDIA_STORAGE_BUCKET',
        schema: FitnessStorageS3Config,
        field: 'bucket'
      },
      {
        description:
          'leaves an unset fallback media region undefined for schema validation',
        env: {
          ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
          ACTIVITIES_MEDIA_STORAGE_BUCKET: 'bucket'
        },
        unset: 'ACTIVITIES_MEDIA_STORAGE_REGION',
        schema: FitnessStorageS3Config,
        field: 'region'
      }
    ])('$description', ({ env, unset, schema, field }) => {
      Object.assign(process.env, env)
      delete process.env[unset]

      const config = getFitnessStorageConfig()

      expect(config).not.toBeNull()
      expect(
        (config?.fitnessStorage as Record<string, unknown>)[field]
      ).toBeUndefined()
      expect(mockWarn).not.toHaveBeenCalled()

      const result = schema.safeParse(config?.fitnessStorage)
      expect(result.success).toBe(false)
      expect(
        result.error?.issues.map((issue) => issue.path.join('.'))
      ).toContain(field)
    })

    // An explicitly configured type that ends up unusable must NOT silently
    // borrow media storage — `getEffectiveFitnessStorageConfig` may only fall
    // back when fitness storage was never configured at all.
    it('reports fitness storage as explicitly configured whenever the type is set', () => {
      expect(hasExplicitFitnessStorageType()).toBe(false)

      process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 's3'
      expect(hasExplicitFitnessStorageType()).toBe(true)
    })

    it('warns and disables fitness storage for an unknown explicit type', () => {
      process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'bogus'
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 's3'
      process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = 'media-bucket'
      process.env.ACTIVITIES_MEDIA_STORAGE_REGION = 'us-east-1'

      expect(getFitnessStorageConfig()).toBeNull()
      expect(hasExplicitFitnessStorageType()).toBe(true)
      expect(mockWarn).toHaveBeenCalledWith(
        'Unknown ACTIVITIES_FITNESS_STORAGE_TYPE value "bogus"; fitness storage will be disabled'
      )
    })
  })
})

describe('getMediaReservedFitnessPathPrefixes', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('always reserves the fallback prefix', () => {
    delete process.env.ACTIVITIES_FITNESS_STORAGE_TYPE
    delete process.env.ACTIVITIES_FITNESS_STORAGE_PREFIX

    expect(getMediaReservedFitnessPathPrefixes()).toEqual(['fitness'])
  })

  it('reserves a configured S3 key prefix as well', () => {
    process.env.ACTIVITIES_FITNESS_STORAGE_PREFIX = '/Activities/Fitness/'

    expect(getMediaReservedFitnessPathPrefixes()).toEqual([
      'fitness',
      'activities/fitness'
    ])
  })

  // The S3 prefix above is the only thing the reservation used to know about, so
  // an operator who instead pointed a LOCAL fitness directory inside the media
  // root under any other name got a directory the media route would serve with
  // no access control — which is the hole the reservation exists to close.
  it('reserves a local fitness directory that sits inside the media root', () => {
    process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'fs'
    process.env.ACTIVITIES_MEDIA_STORAGE_PATH = '/var/uploads'
    process.env.ACTIVITIES_FITNESS_STORAGE_PATH = '/var/uploads/fit-files'

    expect(getMediaReservedFitnessPathPrefixes()).toContain('fit-files')
  })

  it.each([
    {
      description: 'a local fitness directory outside the media root',
      mediaPath: '/var/uploads',
      fitnessPath: '/srv/fitness-files'
    },
    {
      description: 'a local fitness directory equal to the media root',
      // Reserving '' would refuse every media object on the instance.
      mediaPath: '/var/uploads',
      fitnessPath: '/var/uploads'
    }
  ])(
    'reserves nothing extra for $description',
    ({
      mediaPath,
      fitnessPath
    }: {
      mediaPath: string
      fitnessPath: string
    }) => {
      process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'fs'
      process.env.ACTIVITIES_MEDIA_STORAGE_PATH = mediaPath
      process.env.ACTIVITIES_FITNESS_STORAGE_PATH = fitnessPath

      expect(getMediaReservedFitnessPathPrefixes()).toEqual(['fitness'])
    }
  )

  it('ignores the local path when storage is not local', () => {
    process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 's3'
    process.env.ACTIVITIES_MEDIA_STORAGE_PATH = '/var/uploads'
    process.env.ACTIVITIES_FITNESS_STORAGE_PATH = '/var/uploads/fit-files'

    expect(getMediaReservedFitnessPathPrefixes()).toEqual(['fitness'])
  })
})

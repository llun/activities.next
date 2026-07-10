vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn()
  }
}))

describe('Config', () => {
  const originalEnv = process.env
  const originalCwd = process.cwd()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unmock('@/lib/config')
    process.env = { ...originalEnv }
    process.chdir(originalCwd)
  })

  afterAll(() => {
    process.env = originalEnv
    process.chdir(originalCwd)
  })

  it('rejects an empty production secret phase at runtime', async () => {
    const { getConfig } = await import('./index')

    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true
    })
    delete process.env.NEXT_PHASE
    process.env.ACTIVITIES_HOST = 'example.com'
    process.env.ACTIVITIES_SECRET_PHASE = ''
    process.env.ACTIVITIES_ALLOW_EMAILS = '[]'
    process.env.ACTIVITIES_DATABASE_CLIENT = 'better-sqlite3'
    process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME = ':memory:'

    expect(() => getConfig()).toThrow(
      'ACTIVITIES_SECRET_PHASE must be at least 32 characters in production runtime'
    )
  })

  it('ignores root config.json and reads runtime environment config', async () => {
    const fs = await import('fs')
    const os = await import('os')
    const path = await import('path')
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-config-'))

    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({
        host: 'file.example.com',
        serviceName: 'File Service',
        serviceDescription: 'File description',
        languages: ['fr'],
        secretPhase: 'file-secret',
        allowEmails: [],
        database: {
          client: 'better-sqlite3',
          connection: {
            filename: 'file.sqlite'
          },
          useNullAsDefault: true
        }
      })
    )

    process.env.ACTIVITIES_HOST = 'env.example.com'
    process.env.ACTIVITIES_SERVICE_NAME = 'Env Service'
    process.env.ACTIVITIES_SERVICE_DESCRIPTION = 'Env description'
    process.env.ACTIVITIES_LANGUAGES = JSON.stringify(['en', 'nl'])
    process.env.ACTIVITIES_SECRET_PHASE = 'env-secret'
    process.env.ACTIVITIES_ALLOW_EMAILS = '[]'
    process.env.ACTIVITIES_DATABASE_CLIENT = 'better-sqlite3'
    process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME = ':memory:'
    process.chdir(tmpDir)

    try {
      const { logger } = await import('@/lib/utils/logger')
      const { getConfig } = await import('./index')
      const config = getConfig()

      expect(config).toMatchObject({
        host: 'env.example.com',
        serviceName: 'Env Service',
        serviceDescription: 'Env description',
        languages: ['en', 'nl'],
        secretPhase: 'env-secret',
        database: {
          client: 'better-sqlite3',
          connection: {
            filename: ':memory:'
          }
        }
      })
      expect(config.host).not.toBe('file.example.com')
      expect(config.serviceName).not.toBe('File Service')
      expect(config.serviceDescription).not.toBe('File description')
      expect(config.languages).not.toEqual(['fr'])
      expect(config.secretPhase).not.toBe('file-secret')
      expect(config.database.connection).not.toMatchObject({
        filename: 'file.sqlite'
      })
      expect(logger.warn).toHaveBeenCalledWith(
        { configPath: path.join(fs.realpathSync(tmpDir), 'config.json') },
        'Root config.json is no longer supported and will be ignored; migrate settings to ACTIVITIES_* environment variables.'
      )
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { force: true, recursive: true })
    }
  })

  describe('registrationOpen', () => {
    const loadConfig = async () => {
      process.env.ACTIVITIES_HOST = 'example.com'
      process.env.ACTIVITIES_SECRET_PHASE = 'env-secret'
      process.env.ACTIVITIES_ALLOW_EMAILS = '[]'
      process.env.ACTIVITIES_DATABASE_CLIENT = 'better-sqlite3'
      process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME = ':memory:'
      const { getConfig } = await import('./index')
      return getConfig()
    }

    it.each([
      {
        description: 'defaults to open when unset',
        value: undefined,
        open: true
      },
      { description: 'stays open for "true"', value: 'true', open: true },
      {
        description: 'closes only for the literal "false"',
        value: 'false',
        open: false
      },
      { description: 'stays open for any other value', value: 'no', open: true }
    ])('$description', async ({ value, open }) => {
      if (value === undefined) {
        delete process.env.ACTIVITIES_REGISTRATION_OPEN
      } else {
        process.env.ACTIVITIES_REGISTRATION_OPEN = value
      }

      const config = await loadConfig()
      expect(config.registrationOpen).toBe(open)
    })
  })

  describe('instance legal documents', () => {
    const loadConfig = async () => {
      process.env.ACTIVITIES_HOST = 'example.com'
      process.env.ACTIVITIES_SECRET_PHASE = 'env-secret'
      process.env.ACTIVITIES_ALLOW_EMAILS = '[]'
      process.env.ACTIVITIES_DATABASE_CLIENT = 'better-sqlite3'
      process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME = ':memory:'
      const { getConfig } = await import('./index')
      return getConfig()
    }

    it('loads privacy policy and terms of service text from the environment', async () => {
      process.env.ACTIVITIES_PRIVACY_POLICY = 'We keep no logs.'
      process.env.ACTIVITIES_TERMS_OF_SERVICE = 'Be excellent to each other.'

      const config = await loadConfig()
      expect(config.privacyPolicy).toBe('We keep no logs.')
      expect(config.termsOfService).toBe('Be excellent to each other.')
    })

    it('leaves both unset when the variables are absent', async () => {
      delete process.env.ACTIVITIES_PRIVACY_POLICY
      delete process.env.ACTIVITIES_TERMS_OF_SERVICE

      const config = await loadConfig()
      expect(config.privacyPolicy).toBeUndefined()
      expect(config.termsOfService).toBeUndefined()
    })
  })
})

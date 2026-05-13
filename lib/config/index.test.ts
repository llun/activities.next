describe('Config', () => {
  const originalEnv = process.env
  const originalCwd = process.cwd()

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    process.chdir(originalCwd)
  })

  afterAll(() => {
    process.env = originalEnv
    process.chdir(originalCwd)
  })

  it('rejects an empty production secret phase at runtime', async () => {
    jest.unmock('@/lib/config')
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

  it('rejects a short production secret phase from file config at runtime', async () => {
    jest.unmock('@/lib/config')
    const fs = await import('fs')
    const os = await import('os')
    const path = await import('path')
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-config-'))

    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({
        host: 'example.com',
        secretPhase: 'short',
        allowEmails: [],
        database: {
          client: 'better-sqlite3',
          connection: {
            filename: ':memory:'
          },
          useNullAsDefault: true
        }
      })
    )

    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true
    })
    delete process.env.NEXT_PHASE
    process.chdir(tmpDir)

    try {
      const { getConfig } = await import('./index')

      expect(() => getConfig()).toThrow(
        'ACTIVITIES_SECRET_PHASE must be at least 32 characters in production runtime'
      )
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { force: true, recursive: true })
    }
  })
})

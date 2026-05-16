describe('Config', () => {
  const originalEnv = process.env
  const originalCwd = process.cwd()

  beforeEach(() => {
    jest.resetModules()
    jest.unmock('@/lib/config')
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
    process.env.ACTIVITIES_SECRET_PHASE = 'env-secret'
    process.env.ACTIVITIES_ALLOW_EMAILS = '[]'
    process.env.ACTIVITIES_DATABASE_CLIENT = 'better-sqlite3'
    process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME = ':memory:'
    process.chdir(tmpDir)

    try {
      const { getConfig } = await import('./index')

      expect(getConfig()).toMatchObject({
        host: 'env.example.com',
        secretPhase: 'env-secret',
        database: {
          client: 'better-sqlite3',
          connection: {
            filename: ':memory:'
          }
        }
      })
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { force: true, recursive: true })
    }
  })
})

describe('Config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
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
})

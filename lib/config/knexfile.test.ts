import { getKnexfileDatabaseConfig } from '@/lib/config/knexfile.js'

describe('getKnexfileDatabaseConfig', () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (
        key === 'ACTIVITIES_DATABASE' ||
        key.startsWith('ACTIVITIES_DATABASE_') ||
        key === 'ACTIVITIES_DEFAULT_DATABASE_SQLITE_FILENAME'
      ) {
        vi.stubEnv(key, undefined)
      }
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('falls back to the default local SQLite file when nothing is configured', () => {
    expect(getKnexfileDatabaseConfig()).toMatchObject({
      client: 'better-sqlite3',
      connection: { filename: './activities.sqlite' }
    })
  })

  it('uses the ACTIVITIES_DATABASE JSON configuration instead of the default SQLite file', () => {
    const database = {
      client: 'pg',
      connection: { host: 'db.internal', database: 'activities' }
    }
    vi.stubEnv('ACTIVITIES_DATABASE', JSON.stringify(database))

    expect(getKnexfileDatabaseConfig()).toEqual(database)
  })

  it('lets ACTIVITIES_DATABASE win over the individual variables', () => {
    vi.stubEnv(
      'ACTIVITIES_DATABASE',
      JSON.stringify({ client: 'pg', connection: { host: 'json-host' } })
    )
    vi.stubEnv('ACTIVITIES_DATABASE_CLIENT', 'better-sqlite3')
    vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', './other.sqlite')

    expect(getKnexfileDatabaseConfig()).toMatchObject({ client: 'pg' })
  })

  it('refuses to guess a database when ACTIVITIES_DATABASE is not valid JSON', () => {
    vi.stubEnv('ACTIVITIES_DATABASE', 'activities')

    expect(() => getKnexfileDatabaseConfig()).toThrow(
      'ACTIVITIES_DATABASE must be a JSON Knex configuration'
    )
  })

  it('refuses a JSON value that is not a configuration object', () => {
    vi.stubEnv('ACTIVITIES_DATABASE', '["pg"]')

    expect(() => getKnexfileDatabaseConfig()).toThrow(
      'ACTIVITIES_DATABASE must be a JSON Knex configuration'
    )
  })

  it('infers SQLite when only the SQLite filename is set', () => {
    vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', './only-file.sqlite')

    expect(getKnexfileDatabaseConfig()).toMatchObject({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: './only-file.sqlite' }
    })
  })

  it('keeps reading the individual PostgreSQL variables', () => {
    vi.stubEnv('ACTIVITIES_DATABASE_CLIENT', 'pg')
    vi.stubEnv('ACTIVITIES_DATABASE_PG_HOST', 'localhost')
    vi.stubEnv('ACTIVITIES_DATABASE_PG_DATABASE', 'activities')

    expect(getKnexfileDatabaseConfig()).toMatchObject({
      client: 'pg',
      connection: { host: 'localhost', database: 'activities' }
    })
  })
})

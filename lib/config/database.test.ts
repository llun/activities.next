import { logger } from '@/lib/utils/logger'

import { getDatabaseConfig, parseKnexDatabaseConfig } from './database'

const poolOf = (config: ReturnType<typeof getDatabaseConfig>) =>
  config?.database.client === 'pg' ? config.database.pool : undefined

describe('Database config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('getDatabaseConfig', () => {
    it('returns null when no database env vars', () => {
      const config = getDatabaseConfig()
      expect(config).toBeNull()
    })

    it('parses ACTIVITIES_DATABASE json env var', () => {
      process.env.ACTIVITIES_DATABASE = JSON.stringify({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' }
      })

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      expect(config?.database.client).toBe('better-sqlite3')
    })

    it('builds better-sqlite3 config with default filename', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'better-sqlite3'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      expect(config?.database.client).toBe('better-sqlite3')
      expect(
        (config?.database.connection as { filename: string }).filename
      ).toBe(':memory:')
    })

    it('builds pg config from env vars', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
      process.env.ACTIVITIES_DATABASE_PG_HOST = 'localhost'
      process.env.ACTIVITIES_DATABASE_PG_PORT = '5432'
      process.env.ACTIVITIES_DATABASE_PG_USER = 'user'
      process.env.ACTIVITIES_DATABASE_PG_PASSWORD = 'pass'
      process.env.ACTIVITIES_DATABASE_PG_DATABASE = 'testdb'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      expect(config?.database.client).toBe('pg')
      const conn = config?.database.connection as {
        host: string
        port: number
        user: string
        password: string
        database: string
      }
      expect(conn.host).toBe('localhost')
      expect(conn.port).toBe(5432)
      expect(conn.user).toBe('user')
    })

    it('defaults the pg pool to min 1 and max 5', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
      delete process.env.ACTIVITIES_DATABASE_PG_POOL_MIN
      delete process.env.ACTIVITIES_DATABASE_PG_POOL_MAX

      const config = getDatabaseConfig()

      expect(poolOf(config)).toEqual({ min: 1, max: 5 })
    })

    it('reads the pg pool size from env vars', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
      process.env.ACTIVITIES_DATABASE_PG_POOL_MIN = '2'
      process.env.ACTIVITIES_DATABASE_PG_POOL_MAX = '20'

      const config = getDatabaseConfig()

      expect(poolOf(config)).toEqual({ min: 2, max: 20 })
    })

    // Knex could not use these: tarn refused them when it was built, and with
    // a max of 0 Knex built no pool. They now fail when the configuration is
    // read.
    it.each([
      ['MAX', 'abc', 'the pool max must be an integer > 0'],
      ['MAX', '0', 'the pool max must be an integer > 0'],
      ['MAX', '-3', 'the pool max must be an integer > 0'],
      ['MIN', 'abc', 'the pool min must be an integer >= 0'],
      ['MIN', '-1', 'the pool min must be an integer >= 0'],
      ['MIN', '6', 'the pool max is smaller than min']
    ])(
      'refuses ACTIVITIES_DATABASE_PG_POOL_%s=%s',
      (variable, value, message) => {
        process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
        process.env[`ACTIVITIES_DATABASE_PG_POOL_${variable}`] = value

        expect(() => getDatabaseConfig()).toThrow(
          'Invalid ACTIVITIES_DATABASE_PG_POOL_MIN / ACTIVITIES_DATABASE_PG_POOL_MAX: ' +
            message
        )
      }
    )

    it('accepts a pool min of 0 and a min equal to max', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
      process.env.ACTIVITIES_DATABASE_PG_POOL_MIN = '0'
      expect(poolOf(getDatabaseConfig())).toEqual({ min: 0, max: 5 })
      process.env.ACTIVITIES_DATABASE_PG_POOL_MIN = '5'
      expect(poolOf(getDatabaseConfig())).toEqual({ min: 5, max: 5 })
    })

    it('builds pg config with ssl require', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
      process.env.ACTIVITIES_DATABASE_PG_SSL_MODE = 'require'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      expect(config?.database.client).toBe('pg')
      const conn = config?.database.connection as {
        ssl: { rejectUnauthorized: boolean }
      }
      expect(conn.ssl.rejectUnauthorized).toBe(false)
    })

    it('builds pg config with ssl verify-full', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
      process.env.ACTIVITIES_DATABASE_PG_SSL_MODE = 'verify-full'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      const conn = config?.database.connection as {
        ssl: { rejectUnauthorized: boolean }
      }
      expect(conn.ssl.rejectUnauthorized).toBe(true)
    })

    it('builds pg config with ssl verify-ca', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
      process.env.ACTIVITIES_DATABASE_PG_SSL_MODE = 'verify-ca'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      const conn = config?.database.connection as {
        ssl: {
          rejectUnauthorized: boolean
          checkServerIdentity: () => undefined
        }
      }
      expect(conn.ssl.rejectUnauthorized).toBe(true)
      expect(conn.ssl.checkServerIdentity()).toBeUndefined()
    })

    it('builds pg config with ssl disable', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
      process.env.ACTIVITIES_DATABASE_PG_SSL_MODE = 'disable'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      const conn = config?.database.connection as Record<string, unknown>
      expect(conn.ssl).toBeUndefined()
    })

    it('builds pg config with ssl verify-full does not have checkServerIdentity', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
      process.env.ACTIVITIES_DATABASE_PG_SSL_MODE = 'verify-full'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      const conn = config?.database.connection as {
        ssl: { rejectUnauthorized: boolean; checkServerIdentity?: unknown }
      }
      expect(conn.ssl.rejectUnauthorized).toBe(true)
      expect(conn.ssl.checkServerIdentity).toBeUndefined()
    })

    it.each(['unknown', 'sqlite3', 'pg-native', 'mysql', 'mysql2'])(
      'throws for the unsupported %s client, naming the supported ones',
      (client) => {
        process.env.ACTIVITIES_DATABASE_CLIENT = client

        expect(() => getDatabaseConfig()).toThrow(
          `Unsupported database client "${client}": only better-sqlite3 ` +
            '(SQLite) and pg (PostgreSQL) are supported'
        )
      }
    )

    it('returns null when the database client is empty', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = ''

      expect(getDatabaseConfig()).toBeNull()
    })
  })

  // ACTIVITIES_DATABASE is JSON written for Knex. The keys the connection uses
  // are kept, the rest are ignored with a warning.
  describe('parseKnexDatabaseConfig', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    const warnings = () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
      return () => warn.mock.calls.map(([fields]) => fields)
    }

    it('keeps a better-sqlite3 filename and always sets useNullAsDefault', () => {
      const warned = warnings()
      expect(
        parseKnexDatabaseConfig({
          client: 'better-sqlite3',
          connection: { filename: 'data.sqlite' }
        })
      ).toEqual({
        client: 'better-sqlite3',
        connection: { filename: 'data.sqlite' },
        useNullAsDefault: true
      })
      expect(warned()).toEqual([])
    })

    it('reads a bare better-sqlite3 connection string as the filename', () => {
      expect(
        parseKnexDatabaseConfig({
          client: 'better-sqlite3',
          connection: ':memory:',
          useNullAsDefault: true
        })
      ).toEqual({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true
      })
    })

    it('refuses better-sqlite3 without a filename', () => {
      expect(() =>
        parseKnexDatabaseConfig({ client: 'better-sqlite3', connection: {} })
      ).toThrow()
    })

    it('keeps the pg connection object as given, with pool and timeout', () => {
      const warned = warnings()
      const connection = {
        host: 'db.internal',
        port: 5432,
        user: 'app',
        password: 'secret',
        database: 'activities',
        ssl: { rejectUnauthorized: false },
        application_name: 'custom'
      }
      expect(
        parseKnexDatabaseConfig({
          client: 'pg',
          connection,
          pool: { min: 0, max: 7 },
          acquireConnectionTimeout: 5000
        })
      ).toEqual({
        client: 'pg',
        connection,
        pool: { min: 0, max: 7 },
        acquireConnectionTimeout: 5000
      })
      expect(warned()).toEqual([])
    })

    // Knex took Math.min of its timeouts, so a numeric string worked as a
    // number; tarn refused what was not a whole number > 0 ("abc" was NaN).
    it.each([
      ['30000', 30000],
      [' 5000 ', 5000]
    ])(
      'reads an acquireConnectionTimeout of %j as the number %j',
      (acquireConnectionTimeout, expected) => {
        expect(
          parseKnexDatabaseConfig({
            client: 'pg',
            connection: { host: 'db' },
            acquireConnectionTimeout
          })
        ).toMatchObject({ acquireConnectionTimeout: expected })
      }
    )

    it.each(['abc', '', '0', '-5', '1.5', 0, -1, null])(
      'refuses an acquireConnectionTimeout of %j, which Knex could not use',
      (acquireConnectionTimeout) => {
        expect(() =>
          parseKnexDatabaseConfig({
            client: 'pg',
            connection: { host: 'db' },
            acquireConnectionTimeout
          })
        ).toThrow()
      }
    )

    it('keeps a pg connection string', () => {
      expect(
        parseKnexDatabaseConfig({
          client: 'pg',
          connection: 'postgres://app:secret@db.internal:5432/activities'
        })
      ).toEqual({
        client: 'pg',
        connection: 'postgres://app:secret@db.internal:5432/activities'
      })
    })

    it.each(['postgres', 'postgresql'])(
      "reads Knex's %s alias as pg",
      (client) => {
        expect(
          parseKnexDatabaseConfig({ client, connection: { host: 'db' } })
        ).toEqual({ client: 'pg', connection: { host: 'db' } })
      }
    )

    it('leaves the pool unset when the JSON has none', () => {
      const config = parseKnexDatabaseConfig({
        client: 'pg',
        connection: { host: 'db' }
      })
      expect(config.client === 'pg' && config.pool).toBeUndefined()
    })

    it('ignores the settings it does not use, and names them in a warning', () => {
      const warned = warnings()
      expect(
        parseKnexDatabaseConfig({
          client: 'pg',
          connection: { host: 'db' },
          searchPath: ['public'],
          debug: true,
          useNullAsDefault: true,
          pool: { min: 1, max: 4, idleTimeoutMillis: 1000, afterCreate: null }
        })
      ).toEqual({
        client: 'pg',
        connection: { host: 'db' },
        pool: { min: 1, max: 4 }
      })
      expect(warned()).toEqual([
        {
          keys: [
            'searchPath',
            'debug',
            'pool.idleTimeoutMillis',
            'pool.afterCreate',
            'useNullAsDefault'
          ]
        }
      ])
    })

    it('names the SQLite settings it does not use', () => {
      const warned = warnings()
      parseKnexDatabaseConfig({
        client: 'better-sqlite3',
        connection: { filename: ':memory:', options: { readonly: true } },
        pool: { max: 1 }
      })
      expect(warned()).toEqual([{ keys: ['connection.options', 'pool'] }])
    })

    it.each(['mysql2', 'sqlite3', 'pg-native', ''])(
      'throws for the unsupported client "%s"',
      (client) => {
        expect(() =>
          parseKnexDatabaseConfig({ client, connection: {} })
        ).toThrow(`Unsupported database client "${client}"`)
      }
    )

    it('refuses a value that is not an object', () => {
      expect(() => parseKnexDatabaseConfig([])).toThrow(
        'ACTIVITIES_DATABASE must be a JSON object'
      )
    })

    it.each([
      [{ max: 0 }, 'pool.max must be an integer > 0'],
      [{ max: 2.5 }, 'pool.max must be an integer > 0'],
      [{ min: -1 }, 'pool.min must be an integer >= 0'],
      // Knex's default min of 2 applies when only max is given.
      [{ max: 1 }, 'pool.max is smaller than min'],
      [{ min: 4, max: 3 }, 'pool.max is smaller than min']
    ])(
      'refuses the pool size %j, which Knex could not use',
      (pool, message) => {
        expect(() =>
          parseKnexDatabaseConfig({
            client: 'pg',
            connection: { host: 'db' },
            pool
          })
        ).toThrow(message)
      }
    )

    // Knex built no pool without a connection; the app reads it as {}, and
    // node-postgres then reads PGHOST, PGUSER, PGPASSWORD, PGDATABASE and the
    // other PG* variables.
    it.each([undefined, null, ''])(
      'reads a pg connection of %j as {}, for the PG* variables',
      (connection) => {
        expect(
          parseKnexDatabaseConfig({
            client: 'pg',
            ...(connection === undefined ? {} : { connection })
          })
        ).toEqual({ client: 'pg', connection: {} })
      }
    )

    it('refuses a pool size of the wrong type', () => {
      expect(() =>
        parseKnexDatabaseConfig({
          client: 'pg',
          connection: { host: 'db' },
          pool: { max: 'ten' }
        })
      ).toThrow()
    })

    it('is what getDatabaseConfig returns for ACTIVITIES_DATABASE', () => {
      process.env.ACTIVITIES_DATABASE = JSON.stringify({
        client: 'postgresql',
        connection: { host: 'db' },
        pool: { max: 3 }
      })
      expect(getDatabaseConfig()).toEqual({
        database: { client: 'pg', connection: { host: 'db' }, pool: { max: 3 } }
      })
    })
  })
})

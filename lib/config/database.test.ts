import { getDatabaseConfig } from './database'

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

      expect(config?.database.pool).toEqual({ min: 1, max: 5 })
    })

    it('reads the pg pool size from env vars', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
      process.env.ACTIVITIES_DATABASE_PG_POOL_MIN = '2'
      process.env.ACTIVITIES_DATABASE_PG_POOL_MAX = '20'

      const config = getDatabaseConfig()

      expect(config?.database.pool).toEqual({ min: 2, max: 20 })
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
})

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
        client: 'sqlite3',
        connection: { filename: ':memory:' }
      })

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      expect(config?.database.client).toBe('sqlite3')
    })

    it('builds sqlite3 config from env vars', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'sqlite3'
      process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME = '/path/to/db.sqlite'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      expect(config?.database.client).toBe('sqlite3')
      expect(
        (config?.database.connection as { filename: string }).filename
      ).toBe('/path/to/db.sqlite')
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

    it('builds pg-native config with ssl', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'pg-native'
      process.env.ACTIVITIES_DATABASE_PG_SSL_MODE = 'require'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      expect(config?.database.client).toBe('pg-native')
      const conn = config?.database.connection as {
        ssl: { rejectUnauthorized: boolean }
      }
      expect(conn.ssl.rejectUnauthorized).toBe(false)
    })

    it('builds mysql config from env vars', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'mysql'
      process.env.ACTIVITIES_DATABASE_MYSQL_HOST = 'localhost'
      process.env.ACTIVITIES_DATABASE_MYSQL_PORT = '3306'
      process.env.ACTIVITIES_DATABASE_MYSQL_USER = 'user'
      process.env.ACTIVITIES_DATABASE_MYSQL_DATABASE = 'testdb'
      process.env.ACTIVITIES_DATABASE_MYSQL_POOL_MIN = '2'
      process.env.ACTIVITIES_DATABASE_MYSQL_POOL_MAX = '10'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      expect(config?.database.client).toBe('mysql')
      expect(config?.database.pool).toEqual({ min: 2, max: 10 })
    })

    it('builds mysql2 config from env vars', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'mysql2'
      process.env.ACTIVITIES_DATABASE_MYSQL_HOST = 'localhost'

      const config = getDatabaseConfig()

      expect(config).not.toBeNull()
      expect(config?.database.client).toBe('mysql2')
    })

    it('returns null for unknown database client', () => {
      process.env.ACTIVITIES_DATABASE_CLIENT = 'unknown'

      const config = getDatabaseConfig()

      expect(config).toBeNull()
    })
  })
})

import { Knex } from 'knex'

import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestDatabaseWithInstance,
  getTestPgConnection,
  getTestPgPort,
  getTestSQLDatabase,
  getTestSQLDatabaseWithInstance
} from './testUtils'

const mockKnex = vi.fn()
vi.mock('knex', () => ({
  default: (...args: unknown[]) => mockKnex(...args)
}))

const mockPgClientConstructor = vi.fn()
const mockPgClientConnect = vi.fn()
const mockPgClientQuery = vi.fn()
const mockPgClientEnd = vi.fn()

class MockPgClient {
  constructor(config: unknown) {
    mockPgClientConstructor(config)
  }
  connect = mockPgClientConnect
  query = mockPgClientQuery
  end = mockPgClientEnd
}

vi.mock('pg', () => ({
  Client: MockPgClient
}))

const createMockKnexInstance = () => {
  const mockConnection = {
    exec: vi.fn()
  }
  const mockRawQuery = {
    connection: vi.fn().mockResolvedValue(undefined)
  }
  return {
    client: {
      acquireConnection: vi.fn().mockResolvedValue(mockConnection),
      releaseConnection: vi.fn().mockResolvedValue(undefined)
    },
    raw: vi.fn().mockReturnValue(mockRawQuery)
  } as unknown as Knex
}

describe('PostgreSQL test port resolution', () => {
  const initialEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...initialEnv }
    mockKnex.mockReset()
    mockPgClientConstructor.mockReset()
    mockPgClientConnect.mockReset()
    mockPgClientQuery.mockReset()
    mockPgClientEnd.mockReset()

    mockPgClientConnect.mockResolvedValue(undefined)
    mockPgClientQuery.mockResolvedValue(undefined)
    mockPgClientEnd.mockResolvedValue(undefined)

    mockKnex.mockImplementation(() => createMockKnexInstance())
  })

  afterEach(() => {
    process.env = { ...initialEnv }
  })

  it('defaults to port 5432 when absent', () => {
    delete process.env.TEST_DATABASE_PORT
    expect(getTestPgPort()).toBe(5432)
    expect(getTestPgPort(undefined)).toBe(5432)
  })

  it.each([
    ['5432', 5432],
    ['55432', 55432],
    ['1', 1],
    ['65535', 65535]
  ])('resolves valid explicit port %s as %d', (input, expected) => {
    process.env.TEST_DATABASE_PORT = input
    expect(getTestPgPort()).toBe(expected)
    expect(getTestPgPort(input)).toBe(expected)
  })

  it.each([
    '',
    ' ',
    '  ',
    '0',
    '-1',
    '-5432',
    '65536',
    '70000',
    'invalid',
    '5432abc',
    'abc5432',
    ' 5432',
    '5432 ',
    '5432.0',
    '5432.5',
    '0x1538',
    '05432'
  ])('rejects invalid explicit port %s', (input) => {
    process.env.TEST_DATABASE_PORT = input
    expect(() => getTestPgPort()).toThrow(
      /must be a decimal integer between 1 and 65535/
    )
    expect(() => getTestPgPort(input)).toThrow(
      /must be a decimal integer between 1 and 65535/
    )
  })

  it('resolves connection config with defaults when port is absent', () => {
    delete process.env.TEST_DATABASE_PORT
    process.env.TEST_DATABASE_HOST = '127.0.0.1'
    process.env.TEST_DATABASE_USERNAME = 'pguser'
    process.env.TEST_DATABASE_PASSWORD = 'secretpassword'

    expect(getTestPgConnection()).toEqual({
      host: '127.0.0.1',
      port: 5432,
      user: 'pguser',
      password: 'secretpassword'
    })
  })

  it('resolves connection config with explicit port when specified', () => {
    process.env.TEST_DATABASE_PORT = '55432'
    process.env.TEST_DATABASE_HOST = '127.0.0.1'
    process.env.TEST_DATABASE_USERNAME = 'pguser'
    process.env.TEST_DATABASE_PASSWORD = 'secretpassword'

    expect(getTestPgConnection()).toEqual({
      host: '127.0.0.1',
      port: 55432,
      user: 'pguser',
      password: 'secretpassword'
    })
  })

  it('throws from connection config without fallback when port is invalid', () => {
    process.env.TEST_DATABASE_PORT = 'invalid'
    expect(() => getTestPgConnection()).toThrow(
      /must be a decimal integer between 1 and 65535/
    )
  })
})

describe('SQLite test path', () => {
  const initialEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...initialEnv }
    mockKnex.mockReset()
    mockPgClientConstructor.mockReset()
    mockPgClientConnect.mockReset()
    mockPgClientQuery.mockReset()
    mockPgClientEnd.mockReset()

    mockKnex.mockImplementation(() => createMockKnexInstance())
  })

  afterEach(() => {
    process.env = { ...initialEnv }
  })

  it('ignores invalid PostgreSQL port configuration when running SQLite test table', () => {
    process.env.TEST_DATABASE_TYPE = 'sqlite'
    process.env.TEST_DATABASE_PORT = 'invalid'

    expect(() => {
      const table = getTestDatabaseTable()
      expect(table).toHaveLength(1)
      expect(table[0][0]).toBe('sqlite')
    }).not.toThrow()

    expect(mockKnex).toHaveBeenCalledWith(
      expect.objectContaining({
        client: 'better-sqlite3'
      })
    )
    expect(mockPgClientConstructor).not.toHaveBeenCalled()
  })

  it('ignores invalid PostgreSQL port configuration on getTestDatabaseWithInstance', () => {
    process.env.TEST_DATABASE_PORT = 'invalid'

    expect(() => {
      const { database, instance } = getTestDatabaseWithInstance(
        false,
        'sqlite'
      )
      expect(database).toBeDefined()
      expect(instance).toBeDefined()
    }).not.toThrow()

    expect(mockPgClientConstructor).not.toHaveBeenCalled()
  })

  it('ignores invalid PostgreSQL port configuration on SQLite-only database helpers', () => {
    process.env.TEST_DATABASE_PORT = 'invalid'

    expect(() => {
      getTestSQLDatabaseWithInstance()
      getTestSQLDatabase()
    }).not.toThrow()

    expect(mockPgClientConstructor).not.toHaveBeenCalled()
  })
})

describe('PostgreSQL test connection paths', () => {
  const initialEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...initialEnv }
    mockKnex.mockReset()
    mockPgClientConstructor.mockReset()
    mockPgClientConnect.mockReset()
    mockPgClientQuery.mockReset()
    mockPgClientEnd.mockReset()

    mockPgClientConnect.mockResolvedValue(undefined)
    mockPgClientQuery.mockResolvedValue(undefined)
    mockPgClientEnd.mockResolvedValue(undefined)

    mockKnex.mockImplementation(() => createMockKnexInstance())
  })

  afterEach(() => {
    process.env = { ...initialEnv }
  })

  const expectedPgDatabase = (process.env.VITEST_POOL_ID ?? '').replace(
    /\D/g,
    ''
  )
    ? `test_${(process.env.VITEST_POOL_ID ?? '').replace(/\D/g, '')}`
    : 'test'

  it('reuses the same resolved configuration for Knex and administrative client on table database with default port', async () => {
    delete process.env.TEST_DATABASE_PORT
    process.env.TEST_DATABASE_TYPE = 'pg'
    process.env.TEST_DATABASE_HOST = '127.0.0.1'
    process.env.TEST_DATABASE_USERNAME = 'pguser'
    process.env.TEST_DATABASE_PASSWORD = 'pgpassword'

    const table = getTestDatabaseTable()
    expect(table).toHaveLength(1)
    const [name, database, prepare] = table[0]
    expect(name).toBe('pg')

    expect(mockKnex).toHaveBeenCalledWith({
      client: 'pg',
      connection: {
        host: '127.0.0.1',
        port: 5432,
        user: 'pguser',
        password: 'pgpassword',
        database: expectedPgDatabase
      }
    })

    await prepare()

    expect(mockPgClientConstructor).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 5432,
      user: 'pguser',
      password: 'pgpassword',
      database: 'postgres'
    })
    expect(mockPgClientConnect).toHaveBeenCalled()
    expect(mockPgClientQuery).toHaveBeenCalledWith(
      `DROP DATABASE IF EXISTS ${expectedPgDatabase} WITH (FORCE)`
    )
    expect(mockPgClientQuery).toHaveBeenCalledWith(
      `CREATE DATABASE ${expectedPgDatabase}`
    )
    expect(mockPgClientEnd).toHaveBeenCalled()

    await databaseBeforeAll(table)
    await database.migrate()
  })

  it('reuses the same resolved configuration for Knex and administrative client on table database with explicit port', async () => {
    process.env.TEST_DATABASE_PORT = '55432'
    process.env.TEST_DATABASE_TYPE = 'pg'
    process.env.TEST_DATABASE_HOST = '127.0.0.1'
    process.env.TEST_DATABASE_USERNAME = 'pguser'
    process.env.TEST_DATABASE_PASSWORD = 'pgpassword'

    const table = getTestDatabaseTable()
    const [, , prepare] = table[0]

    expect(mockKnex).toHaveBeenCalledWith({
      client: 'pg',
      connection: {
        host: '127.0.0.1',
        port: 55432,
        user: 'pguser',
        password: 'pgpassword',
        database: expectedPgDatabase
      }
    })

    await prepare()

    expect(mockPgClientConstructor).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 55432,
      user: 'pguser',
      password: 'pgpassword',
      database: 'postgres'
    })
  })

  it('reuses the same resolved configuration on isolated instance database', async () => {
    process.env.TEST_DATABASE_PORT = '55432'
    process.env.TEST_DATABASE_TYPE = 'pg'
    process.env.TEST_DATABASE_HOST = '127.0.0.1'
    process.env.TEST_DATABASE_USERNAME = 'pguser'
    process.env.TEST_DATABASE_PASSWORD = 'pgpassword'

    const { database, instance, prepare } = getTestDatabaseWithInstance(
      true,
      'pg'
    )
    expect(database).toBeDefined()
    expect(instance).toBeDefined()

    expect(mockKnex).toHaveBeenCalledWith({
      client: 'pg',
      connection: {
        host: '127.0.0.1',
        port: 55432,
        user: 'pguser',
        password: 'pgpassword',
        database: `${expectedPgDatabase}_isolated`
      }
    })

    await prepare()

    expect(mockPgClientConstructor).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 55432,
      user: 'pguser',
      password: 'pgpassword',
      database: 'postgres'
    })
    expect(mockPgClientQuery).toHaveBeenCalledWith(
      `DROP DATABASE IF EXISTS ${expectedPgDatabase}_isolated WITH (FORCE)`
    )
    expect(mockPgClientQuery).toHaveBeenCalledWith(
      `CREATE DATABASE ${expectedPgDatabase}_isolated`
    )
    expect(mockPgClientEnd).toHaveBeenCalled()
  })

  it('rejects invalid PostgreSQL port configuration before establishing connections on table database', () => {
    process.env.TEST_DATABASE_PORT = 'invalid'
    process.env.TEST_DATABASE_TYPE = 'pg'

    expect(() => getTestDatabaseTable()).toThrow(
      /must be a decimal integer between 1 and 65535/
    )
    expect(mockKnex).not.toHaveBeenCalled()
    expect(mockPgClientConstructor).not.toHaveBeenCalled()
  })

  it('rejects invalid PostgreSQL port configuration before establishing connections on instance database', () => {
    process.env.TEST_DATABASE_PORT = 'invalid'

    expect(() => getTestDatabaseWithInstance(false, 'pg')).toThrow(
      /must be a decimal integer between 1 and 65535/
    )
    expect(mockKnex).not.toHaveBeenCalled()
    expect(mockPgClientConstructor).not.toHaveBeenCalled()
  })
})

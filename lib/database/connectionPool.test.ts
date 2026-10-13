import { sql } from 'kysely'
import { EventEmitter } from 'node:events'
import pg from 'pg'

import {
  getDatabaseConfig,
  parseKnexDatabaseConfig
} from '@/lib/config/database'
import { createDatabaseConnection } from '@/lib/database/connection'
import { dynamicImport } from '@/lib/utils/dynamicImport'

// The options the connection builds its node-postgres pool with, for the
// configurations production reads. No server is involved: `pg` is replaced by
// a module whose Pool records its options and never connects.
vi.mock('@/lib/utils/dynamicImport', () => ({ dynamicImport: vi.fn() }))

const created: Record<string, unknown>[] = []

class RecordingPool extends EventEmitter {
  readonly options: Record<string, unknown>
  readonly waitingCount = 0

  constructor(options: Record<string, unknown>) {
    super()
    this.options = options
    created.push(options)
  }

  async connect(): Promise<never> {
    throw new Error('no server in this test')
  }

  async end() {}
}

// The pool is built on the first query, which then fails to connect.
const poolOptionsFor = async (
  config: Parameters<typeof createDatabaseConnection>[0]
) => {
  const handle = createDatabaseConnection(config)
  try {
    await expect(sql`select 1`.execute(handle.db)).rejects.toThrow(
      'no server in this test'
    )
  } finally {
    await handle.destroy()
  }
  expect(created).toHaveLength(1)
  return created[0]
}

describe('the PostgreSQL pool options', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    created.length = 0
    vi.mocked(dynamicImport).mockResolvedValue({
      Pool: RecordingPool,
      Client: pg.Client,
      types: pg.types
    })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('keeps Knex pool timings and the env defaults for ACTIVITIES_DATABASE_PG_*', async () => {
    process.env.ACTIVITIES_DATABASE_CLIENT = 'pg'
    process.env.ACTIVITIES_DATABASE_PG_HOST = 'db.internal'
    const config = getDatabaseConfig()
    if (!config) throw new Error('expected a database configuration')

    const options = await poolOptionsFor(config.database)
    expect(options).toEqual({
      application_name: 'Activities.next',
      host: 'db.internal',
      min: 1,
      max: 5,
      connectionTimeoutMillis: 60_000,
      idleTimeoutMillis: 30_000,
      types: expect.objectContaining({ getTypeParser: expect.any(Function) })
    })
    // Per-client parsers, never the global pg.types.
    expect(options.types).not.toBe(pg.types)
  })

  it("uses Knex's pool size when the ACTIVITIES_DATABASE JSON has no pool", async () => {
    const options = await poolOptionsFor(
      parseKnexDatabaseConfig({ client: 'pg', connection: { host: 'db' } })
    )
    expect(options).toEqual({
      application_name: 'Activities.next',
      host: 'db',
      min: 2,
      max: 10,
      connectionTimeoutMillis: 60_000,
      idleTimeoutMillis: 30_000,
      types: expect.objectContaining({ getTypeParser: expect.any(Function) })
    })
  })

  it('passes a configured pool size and acquire timeout through', async () => {
    const options = await poolOptionsFor(
      parseKnexDatabaseConfig({
        client: 'pg',
        connection: { host: 'db', application_name: 'custom' },
        pool: { min: 3, max: 7 },
        acquireConnectionTimeout: 1_234
      })
    )
    expect(options).toMatchObject({
      application_name: 'custom',
      min: 3,
      max: 7,
      connectionTimeoutMillis: 1_234,
      idleTimeoutMillis: 30_000
    })
  })
})

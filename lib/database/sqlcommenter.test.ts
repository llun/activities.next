import { Span, trace } from '@opentelemetry/api'
import { sql } from 'kysely'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type DatabaseHandle,
  createDatabaseConnection
} from '@/lib/database/connection'
import { inTransaction } from '@/lib/database/kysely'
import {
  createTestDatabase,
  getTestDatabaseConfig
} from '@/lib/database/testing/createTestDatabase'

import { getTraceparentCommentSuffix } from './sqlcommenter'

const traceparent =
  "/* traceparent='00-02dad5002ab305f1fd75ae8bd0d46e94-3ca938408dc381d3-01' */"

const spanWith = (spanContext: {
  traceId: string
  spanId: string
  traceFlags: number
}) => ({ spanContext: () => spanContext }) as unknown as Span

const validSpan = spanWith({
  traceId: '02dad5002ab305f1fd75ae8bd0d46e94',
  spanId: '3ca938408dc381d3',
  traceFlags: 1
})

describe('getTraceparentCommentSuffix', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a leading-space comment naming the active span', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(validSpan)
    expect(getTraceparentCommentSuffix()).toBe(` ${traceparent}`)
  })

  it('is null without an active span', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined)
    expect(getTraceparentCommentSuffix()).toBeNull()
  })

  it('is null for an invalid span context', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(
      spanWith({
        traceId: '00000000000000000000000000000000',
        spanId: '0000000000000000',
        traceFlags: 0
      })
    )
    expect(getTraceparentCommentSuffix()).toBeNull()
  })

  it('is null when reading the span throws', () => {
    vi.spyOn(trace, 'getActiveSpan').mockImplementation(() => {
      throw new Error('tracer broke')
    })
    expect(getTraceparentCommentSuffix()).toBeNull()
  })
})

// Cloud SQL Insights reads the trace tag from a comment TRAILING the
// statement, so the connection with `sqlcommenter` on appends it to every
// statement it sends. Runs on SQLite and, under TEST_DATABASE_TYPE=pg,
// PostgreSQL, where the server is asked what it received.
describe('sqlcommenter on the connection', () => {
  const backend = process.env.TEST_DATABASE_TYPE === 'pg' ? 'pg' : 'sqlite'
  const testDb = createTestDatabase()
  let connection: DatabaseHandle

  const capture = async (run: () => Promise<unknown>) => {
    const statements: string[] = []
    const stop = connection.onQuery(({ sql }) => statements.push(sql))
    try {
      await run()
    } finally {
      stop()
    }
    return statements
  }

  beforeAll(async () => {
    // No `migrate()` here: this suite only sends `select 1`-shaped statements
    // through its own connection, so it wants an empty database.
    await testDb.prepareEmpty()
    connection = createDatabaseConnection(getTestDatabaseConfig(backend), {
      sqlcommenter: true
    })
  })

  afterAll(async () => {
    await connection.destroy()
    await testDb.destroy()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('appends the traceparent comment as a suffix of the statement sent', async () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(validSpan)
    const statements = await capture(() =>
      sql`select 1 as one`.execute(connection.db)
    )
    expect(statements).toEqual([`select 1 as one ${traceparent}`])
  })

  it('appends it to every statement of a transaction', async () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(validSpan)
    const statements = await capture(() =>
      inTransaction(connection.db, (trx) => sql`select 2 as two`.execute(trx))
    )
    expect(statements).toEqual([
      `begin ${traceparent}`,
      `select 2 as two ${traceparent}`,
      `commit ${traceparent}`
    ])
  })

  it.runIf(backend === 'pg')(
    'reaches the server as part of the statement text',
    async () => {
      vi.spyOn(trace, 'getActiveSpan').mockReturnValue(validSpan)
      const { rows } = await sql<{ query: string }>`
        select query from pg_stat_activity where pid = pg_backend_pid()
      `.execute(connection.db)
      const query = rows[0].query.trimEnd()
      expect(query.slice(-traceparent.length)).toBe(traceparent)
    }
  )

  it('adds nothing when there is no active span', async () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined)
    const statements = await capture(() =>
      sql`select 1 as one`.execute(connection.db)
    )
    expect(statements).toEqual(['select 1 as one'])
  })

  it('adds nothing on a connection without sqlcommenter', async () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(validSpan)
    const statements: string[] = []
    const stop = testDb.onQuery(({ sql }) => statements.push(sql))
    try {
      await sql`select 1 as one`.execute(testDb.db)
    } finally {
      stop()
    }
    expect(statements).toEqual(['select 1 as one'])
  })
})

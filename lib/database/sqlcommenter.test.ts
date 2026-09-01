import { Span, trace } from '@opentelemetry/api'
import knex from 'knex'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachSqlcommenter } from './index'

describe('attachSqlcommenter', () => {
  const db = attachSqlcommenter(
    knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
  )

  // Capture on the dialect class prototype, not the knex instance: a
  // transaction client is built via Object.create(client.constructor.prototype)
  // and never consults instance-level properties.
  let executedSql: string[] = []
  const clientProto = db.client.constructor.prototype
  const origDriverQuery = clientProto._query
  clientProto._query = function (
    conn: unknown,
    obj: { sql: string; [key: string]: unknown }
  ) {
    executedSql.push(obj.sql)
    return origDriverQuery.apply(this, [conn, obj])
  }

  afterEach(() => {
    vi.restoreAllMocks()
    executedSql = []
  })

  it('appends traceparent comment when active span is present and valid', async () => {
    const mockSpan = {
      spanContext: () => ({
        traceId: '02dad5002ab305f1fd75ae8bd0d46e94',
        spanId: '3ca938408dc381d3',
        traceFlags: 1
      })
    } as unknown as Span

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan)

    await db.raw('SELECT 1')

    expect(executedSql[0]).toContain(
      "/*traceparent='00-02dad5002ab305f1fd75ae8bd0d46e94-3ca938408dc381d3-01'*/"
    )
  })

  it('appends traceparent comment to queries inside a transaction', async () => {
    const mockSpan = {
      spanContext: () => ({
        traceId: '02dad5002ab305f1fd75ae8bd0d46e94',
        spanId: '3ca938408dc381d3',
        traceFlags: 1
      })
    } as unknown as Span

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan)

    await db.transaction(async (trx) => {
      await trx.raw('SELECT 1')
    })

    const selects = executedSql.filter((sql) => sql.startsWith('SELECT 1'))
    expect(selects).toHaveLength(1)
    expect(selects[0]).toContain(
      "/*traceparent='00-02dad5002ab305f1fd75ae8bd0d46e94-3ca938408dc381d3-01'*/"
    )
  })

  it('appends the traceparent comment exactly once per execution when the same builder is executed twice', async () => {
    // A builder can be executed more than once (awaiting the same instance
    // twice re-runs `client.runner(this).run()`). The tag is appended to the
    // compiled object `query()` is handed, and `toSQL()` builds that object
    // fresh per execution — so the second run must carry exactly one tag of
    // its own, never a stacked copy of the first.
    const mockSpan = {
      spanContext: () => ({
        traceId: '02dad5002ab305f1fd75ae8bd0d46e94',
        spanId: '3ca938408dc381d3',
        traceFlags: 1
      })
    } as unknown as Span

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan)

    const query = db.raw('SELECT 1')
    await query
    await query

    expect(executedSql).toHaveLength(2)
    for (const sql of executedSql) {
      const occurrences = sql.match(/\/\*traceparent=/g) ?? []
      expect(occurrences).toHaveLength(1)
    }
  })

  it('appends the traceparent comment as a SUFFIX, never a leading comment', async () => {
    // Cloud SQL Insights (and the sqlcommenter spec generally) parses the
    // trace tag out of a comment trailing the statement. knex's own
    // `builder.comment()` always compiles as a LEADING comment, so this test
    // pins the placement explicitly rather than merely asserting the tag is
    // present somewhere in the string (see `toContain` above, which passes
    // whether the tag is a prefix or a suffix and would not have caught the
    // original bug).
    const mockSpan = {
      spanContext: () => ({
        traceId: '02dad5002ab305f1fd75ae8bd0d46e94',
        spanId: '3ca938408dc381d3',
        traceFlags: 1
      })
    } as unknown as Span

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan)

    await db.raw('SELECT 1')

    const sql = executedSql[0]

    // The statement the driver receives must not START with the comment
    // (that is what knex's `builder.comment()` produces) and must END with
    // it instead.
    expect(sql).not.toMatch(/^\s*\/\*/)
    expect(sql).toMatch(
      /\/\*traceparent='00-02dad5002ab305f1fd75ae8bd0d46e94-3ca938408dc381d3-01'\*\/\s*$/
    )
    expect(sql.indexOf('/*')).toBeGreaterThan(sql.indexOf('SELECT'))
  })

  it('appends the comment before bindings are positioned, so bound values still resolve', async () => {
    // `client.query()` hands the compiled object to knex's `enrichQueryObject`,
    // which rewrites binding positions for the dialect (`?` -> `$1` on
    // PostgreSQL) AFTER this wrapper has appended the tag. The tag carries no
    // `?`, so it cannot shift a binding — pinned by executing a bound
    // statement and checking both the SQL the driver received and the value
    // it resolved.
    const mockSpan = {
      spanContext: () => ({
        traceId: '02dad5002ab305f1fd75ae8bd0d46e94',
        spanId: '3ca938408dc381d3',
        traceFlags: 1
      })
    } as unknown as Span

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan)

    const rows = await db.raw('SELECT ? AS value', [42])

    expect(rows).toEqual([{ value: 42 }])
    expect(executedSql[0]).toBe(
      "SELECT ? AS value /*traceparent='00-02dad5002ab305f1fd75ae8bd0d46e94-3ca938408dc381d3-01'*/"
    )
  })

  it('does not append comment when no active span exists', async () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined)

    await db.raw('SELECT 1')

    expect(executedSql[0]).not.toContain('traceparent')
  })

  it('does not append comment when span context is invalid', async () => {
    const mockSpan = {
      spanContext: () => ({
        traceId: '00000000000000000000000000000000',
        spanId: '0000000000000000',
        traceFlags: 0
      })
    } as unknown as Span

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan)

    await db.raw('SELECT 1')

    expect(executedSql[0]).not.toContain('traceparent')
  })

  it('does not double-attach the comment when a second knex instance shares the dialect prototype', async () => {
    // Same client ('better-sqlite3') as `db` above, so this instance's
    // client.constructor is the identical class object, and the guard on
    // its shared prototype must stop attachSqlcommenter from wrapping
    // `query` a second time.
    const secondDb = attachSqlcommenter(
      knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: ':memory:' }
      })
    )

    const mockSpan = {
      spanContext: () => ({
        traceId: '02dad5002ab305f1fd75ae8bd0d46e94',
        spanId: '3ca938408dc381d3',
        traceFlags: 1
      })
    } as unknown as Span

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan)

    await secondDb.raw('SELECT 2')

    const selects = executedSql.filter((sql) => sql.startsWith('SELECT 2'))
    expect(selects).toHaveLength(1)
    const traceparentOccurrences = selects[0].match(/\/\*traceparent=/g) ?? []
    expect(traceparentOccurrences).toHaveLength(1)
  })
})

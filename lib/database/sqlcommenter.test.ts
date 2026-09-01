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

  it('appends the traceparent comment only once when the same builder is executed twice', async () => {
    // knex fires `start` once per execution, and a builder can be executed
    // more than once. Without an idempotency guard the second `start` captures
    // the already-patched toSQL and stacks a second identical suffix.
    const mockSpan = {
      spanContext: () => ({
        traceId: '02dad5002ab305f1fd75ae8bd0d46e94',
        spanId: '3ca938408dc381d3',
        traceFlags: 1
      })
    } as unknown as Span

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan)

    const query = db('statuses').select('*')
    db.emit('start', query)
    db.emit('start', query)

    const occurrences = query.toSQL().sql.match(/\/\* traceparent=/g) ?? []
    expect(occurrences).toHaveLength(1)
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

    const query = db('statuses').select('*')
    db.emit('start', query)

    const sql = query.toSQL().sql

    // The compiled statement must not START with the comment (that is what
    // knex's `builder.comment()` produces) and must END with it instead.
    expect(sql).not.toMatch(/^\s*\/\*/)
    expect(sql).toMatch(
      /\/\* traceparent='00-02dad5002ab305f1fd75ae8bd0d46e94-3ca938408dc381d3-01' \*\/\s*$/
    )
    expect(sql.indexOf('/*')).toBeGreaterThan(sql.indexOf('select'))
  })

  it('appends the traceparent comment onto toNative() output too', async () => {
    // `Sql#toNative()` is a separate closure over the same compiled object;
    // some dialects read `.sql` through it rather than the plain `.sql`
    // field, so the suffix must be visible there as well.
    const mockSpan = {
      spanContext: () => ({
        traceId: '02dad5002ab305f1fd75ae8bd0d46e94',
        spanId: '3ca938408dc381d3',
        traceFlags: 1
      })
    } as unknown as Span

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan)

    const query = db('statuses').select('*')
    db.emit('start', query)

    const compiled = query.toSQL()
    const native = compiled.toNative()
    expect(native.sql).toMatch(
      /\/\* traceparent='00-02dad5002ab305f1fd75ae8bd0d46e94-3ca938408dc381d3-01' \*\/\s*$/
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

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

  let executedSql: string[] = []
  const origDriverQuery = db.client._query
  db.client._query = function (
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
})

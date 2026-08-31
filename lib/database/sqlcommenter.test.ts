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

  afterEach(() => {
    vi.restoreAllMocks()
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

    const query = db('statuses').select('*')
    // Trigger query start event
    db.emit('start', query)

    const sql = query.toSQL().sql
    expect(sql).toContain(
      "/* traceparent='00-02dad5002ab305f1fd75ae8bd0d46e94-3ca938408dc381d3-01' */"
    )
  })

  it('does not append comment when no active span exists', async () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined)

    const query = db('statuses').select('*')
    db.emit('start', query)

    const sql = query.toSQL().sql
    expect(sql).not.toContain('traceparent')
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

    const query = db('statuses').select('*')
    db.emit('start', query)

    const sql = query.toSQL().sql
    expect(sql).not.toContain('traceparent')
  })
})

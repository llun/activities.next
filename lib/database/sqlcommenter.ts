import { trace } from '@opentelemetry/api'
import type { Knex } from 'knex'

// Databases whose Knex instance `attachSqlcommenter` (lib/database/index.ts)
// has hooked, keyed by the Knex client's `config` object, which a Knex
// transaction's client shares with the root client. The Kysely driver
// (lib/database/kysely/driver.ts) reads this so a Kysely query, on the root
// instance or on `kyselyFor(trx)`, carries the same trailing comment as a Knex
// one, and a bare test instance without the hook gets none.
const configs = new WeakSet<object>()

export const markSqlcommenterAttached = (db: Knex) => {
  const config = db.client?.config
  if (config) configs.add(config)
}

export const isSqlcommenterAttached = (client: Knex.Client) =>
  Boolean(client.config) && configs.has(client.config)

// sqlcommenter (https://google.github.io/sqlcommenter/spec/) trailing comment
// for the active span, e.g. ` /* traceparent='00-<trace>-<span>-01' */`, or
// null when there is no valid active span. The leading space is part of the
// suffix so callers can append it to compiled SQL as-is. Never throws: tracing
// failures must not alter query execution.
export const getTraceparentCommentSuffix = (): string | null => {
  try {
    const span = trace.getActiveSpan()
    if (!span) return null
    const spanContext = span.spanContext()
    if (!trace.isSpanContextValid(spanContext)) return null

    const traceFlags = spanContext.traceFlags.toString(16).padStart(2, '0')
    const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${traceFlags}`
    return ` /* traceparent='${traceparent}' */`
  } catch {
    return null
  }
}

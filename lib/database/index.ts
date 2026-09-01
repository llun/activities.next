import { trace } from '@opentelemetry/api'
import knex, { Knex } from 'knex'
import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

interface DatabaseInstance {
  database: Database
  knex: Knex
}

// Symbol.for (global registry), not Symbol(): Next.js dev Fast Refresh
// re-evaluates this module while the cached knex dialect class survives, so a
// per-module Symbol() would never match on reload and query would be
// re-wrapped every time, stacking duplicate traceparent comments.
const SQLCOMMENTER_ATTACHED = Symbol.for('activities.next.sqlcommenter')

export const attachSqlcommenter = (db: Knex): Knex => {
  // Patch the dialect class prototype, not the knex instance: knex builds each
  // transaction client via Object.create(client.constructor.prototype), so an
  // instance-level override is invisible to every query inside a transaction.
  const proto = db.client?.constructor?.prototype
  const origQuery = proto?.query
  if (typeof origQuery === 'function' && !proto[SQLCOMMENTER_ATTACHED]) {
    proto[SQLCOMMENTER_ATTACHED] = true
    proto.query = function (
      connection: unknown,
      obj: { sql: string; [key: string]: unknown } | string
    ) {
      try {
        const span = trace.getActiveSpan()
        if (span) {
          const spanContext = span.spanContext()
          if (trace.isSpanContextValid(spanContext)) {
            const traceFlags = spanContext.traceFlags
              .toString(16)
              .padStart(2, '0')
            const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${traceFlags}`
            const comment = `/*traceparent='${traceparent}'*/`

            if (typeof obj === 'string') {
              obj = `${obj} ${comment}`
            } else if (obj && typeof obj.sql === 'string') {
              obj.sql = `${obj.sql} ${comment}`
            }
          }
        }
      } catch {
        // Tracing failures must never alter query execution
      }

      return origQuery.call(this, connection, obj)
    }
  }
  return db
}

const getDatabaseInstance = memoize((): DatabaseInstance | null => {
  const config = getConfig()
  const db = attachSqlcommenter(knex(config.database))
  return { database: getSQLDatabase(db), knex: db }
})

export const getKnex = (): Knex => {
  const instance = getDatabaseInstance()
  if (!instance) {
    throw new Error('Database not initialized')
  }
  return instance.knex
}

export const getDatabase = (): Database | null => {
  return getDatabaseInstance()?.database ?? null
}

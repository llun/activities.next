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

export const attachSqlcommenter = (db: Knex): Knex => {
  db.on('start', (builder: Knex.QueryBuilder) => {
    try {
      const span = trace.getActiveSpan()
      if (!span) return
      const spanContext = span.spanContext()
      if (!trace.isSpanContextValid(spanContext)) return

      const traceFlags = spanContext.traceFlags.toString(16).padStart(2, '0')
      const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${traceFlags}`
      if (typeof builder?.comment === 'function') {
        builder.comment(`traceparent='${traceparent}'`)
      }
    } catch {
      // Tracing failures must never alter query execution
    }
  })
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

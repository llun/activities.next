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

interface WrappedClient {
  query: (
    connection: unknown,
    obj: { sql: string; [key: string]: unknown } | string
  ) => unknown
  __sqlcommenterWrapped__?: boolean
}

export const attachSqlcommenter = (db: Knex): Knex => {
  const Client = (db.client?.constructor ??
    (knex as unknown as { Client: { prototype: WrappedClient } }).Client) as {
    prototype: WrappedClient
  }
  const target = Client?.prototype ?? (db.client as unknown as WrappedClient)
  if (target && !target.__sqlcommenterWrapped__) {
    const origQuery = target.query
    if (typeof origQuery === 'function') {
      target.query = function (
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
      target.__sqlcommenterWrapped__ = true
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

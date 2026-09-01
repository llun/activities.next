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

// sqlcommenter (https://google.github.io/sqlcommenter/spec/) — and Cloud SQL
// Insights specifically, which is why this exists — parses the trace tag out
// of a TRAILING SQL comment. knex's own `builder.comment()` cannot produce
// that: its query compiler's `components` order always places `comments`
// before `columns`/`join`/`where`, so `.comment()` compiles as a LEADING
// comment (`/* … */ select …`) no matter when it is called. Insights would
// therefore never see the tag, and the query <-> trace correlation this
// feature exists for would silently never work.
//
// Rather than fight the compiler's fixed component order, wrap this one
// builder's `toSQL()` so the tag is appended to the already-compiled SQL
// string instead. Mutating the returned `Sql` object's `.sql` field (rather
// than re-running the compiler with a different comment placement) also keeps
// `Sql#toNative()` in sync for free: its `toNative()` closure reads `.sql` off
// that same object at call time, so it picks up the appended suffix too.
// Appending happens on the object `toSQL()` hands back, before binding
// positions are rewritten for the target dialect (e.g. `?` -> `$1` for
// PostgreSQL) — the trace tag never contains a `?`, so it cannot shift any
// binding position.
export const attachSqlcommenter = (db: Knex): Knex => {
  db.on('start', (builder: Knex.QueryBuilder) => {
    try {
      const span = trace.getActiveSpan()
      if (!span) return
      const spanContext = span.spanContext()
      if (!trace.isSpanContextValid(spanContext)) return

      const traceFlags = spanContext.traceFlags.toString(16).padStart(2, '0')
      const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${traceFlags}`
      const commentSuffix = ` /* traceparent='${traceparent}' */`

      if (typeof builder?.toSQL !== 'function') return
      // knex fires `start` once per EXECUTION, not once per builder, and a
      // builder can be executed more than once (awaiting the same instance
      // twice re-runs `client.runner(this).run()`). Without this guard the
      // second `start` would capture the already-patched `toSQL` as its
      // "original" and stack a second identical suffix. Mark the instance so a
      // re-fired `start` is a no-op.
      const patchable = builder as Knex.QueryBuilder & {
        __sqlcommenterPatched?: boolean
      }
      if (patchable.__sqlcommenterPatched) return
      patchable.__sqlcommenterPatched = true
      const originalToSQL = builder.toSQL.bind(builder)
      builder.toSQL = () => {
        const compiled = originalToSQL()
        try {
          compiled.sql = `${compiled.sql}${commentSuffix}`
        } catch {
          // Tracing failures must never alter query execution
        }
        return compiled
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

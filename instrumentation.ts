import { SpanStatusCode, trace } from '@opentelemetry/api'
import { type Instrumentation } from 'next'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getConfig } = await import('@/lib/config')
    const config = getConfig()
    const { getDatabase, getKysely } = await import('@/lib/database')
    const database = getDatabase()
    if (database) {
      // Host trust reads the active Admin › Domains rows from an in-process
      // snapshot (synchronous callers cannot query); load it now and keep it
      // fresh. See lib/services/domains/servedDomainSnapshot.ts.
      const { startServedDomainRefresher } =
        await import('@/lib/services/domains/servedDomainSnapshot')
      startServedDomainRefresher(database)
      // Logs pending migrations and does not wait for the check: the app
      // starts either way (docs/maintenance.md).
      const { warnAboutPendingMigrations } =
        await import('@/lib/database/migrate/startupCheck')
      void warnAboutPendingMigrations({
        db: getKysely(),
        config: config.database
      })
      if (config.queue?.type === 'database') {
        const { startDatabaseQueueRunner } =
          await import('@/lib/services/queue/databaseRunner')
        startDatabaseQueueRunner(database, {
          pollIntervalMs: config.queue.pollIntervalMs
        })
      }
      // Delayed actor deletions are carried out by a delayed job under a real
      // queue; this sweep is the only thing that does so under the in-process
      // one, and the safety net for a lost job under the others.
      const { startActorDeletionSweep } =
        await import('@/lib/services/actors/actorDeletion')
      startActorDeletionSweep(database)
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  _request,
  _context
) => {
  const span = trace.getActiveSpan()
  if (span) {
    if (err instanceof Error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message
      })
      span.recordException(err)
    } else {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(err)
      })
      span.recordException(String(err))
    }
  }
}

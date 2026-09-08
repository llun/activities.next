#!/usr/bin/env -S node scripts/run.cjs
import { loadEnvConfig } from '@next/env'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { startDatabaseQueueRunner } from '@/lib/services/queue/databaseRunner'

import { createQueueWorkerShutdown } from './runQueueWorkerLifecycle'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

async function runQueueWorker() {
  const database = getDatabase()
  if (!database) {
    console.error('runQueueWorker: database is not available')
    process.exit(1)
  }

  const config = getConfig()
  const pollIntervalMs =
    config.queue?.type === 'database' ? config.queue.pollIntervalMs : 1000

  console.log(
    `Starting database queue worker (poll interval: ${pollIntervalMs}ms)...`
  )

  const runner = startDatabaseQueueRunner(database, {
    pollIntervalMs
  })

  const shutdownQueueWorker = createQueueWorkerShutdown({
    runner,
    database
  })
  let shutdownExitPromise: Promise<void> | undefined
  const shutdown = (signal: string) => {
    if (shutdownExitPromise) {
      return shutdownExitPromise
    }

    console.log(`Received ${signal}. Shutting down queue worker gracefully...`)

    shutdownExitPromise = shutdownQueueWorker()
      .then((result) => {
        if (result.succeeded) {
          console.log('Queue worker drained and database closed successfully.')
          process.exit(0)
          return
        }

        for (const failure of result.failures) {
          console.error(
            `Error while shutting down queue worker (${failure.stage}):`,
            failure.error
          )
        }
        process.exit(1)
      })
      .catch((error) => {
        console.error('Unexpected queue worker shutdown error:', error)
        process.exit(1)
      })

    return shutdownExitPromise
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

runQueueWorker().catch((error) => {
  console.error('Fatal error running queue worker:', error)
  process.exit(1)
})

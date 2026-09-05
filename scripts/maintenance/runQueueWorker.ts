#!/usr/bin/env -S node scripts/run.cjs
import { loadEnvConfig } from '@next/env'

import { getDatabase } from '@/lib/database'
import { startDatabaseQueueRunner } from '@/lib/services/queue/databaseRunner'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

async function runQueueWorker() {
  const database = getDatabase()
  if (!database) {
    console.error('runQueueWorker: database is not available')
    process.exit(1)
  }

  const pollIntervalMs = process.env.ACTIVITIES_QUEUE_DATABASE_POLL_INTERVAL_MS
    ? parseInt(process.env.ACTIVITIES_QUEUE_DATABASE_POLL_INTERVAL_MS, 10)
    : 1000

  console.log(
    `Starting database queue worker (poll interval: ${pollIntervalMs}ms)...`
  )

  const runner = startDatabaseQueueRunner(database, {
    pollIntervalMs
  })

  const shutdown = () => {
    console.log('Shutting down queue worker gracefully...')
    runner.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

runQueueWorker().catch((error) => {
  console.error('Fatal error running queue worker:', error)
  process.exit(1)
})

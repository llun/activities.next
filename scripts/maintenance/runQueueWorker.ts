#!/usr/bin/env -S node scripts/run.cjs
import { loadEnvConfig } from '@next/env'

import { getConfig } from '@/lib/config'
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

  const config = getConfig()
  const pollIntervalMs =
    config.queue?.type === 'database' ? config.queue.pollIntervalMs : 1000

  console.log(
    `Starting database queue worker (poll interval: ${pollIntervalMs}ms)...`
  )

  const runner = startDatabaseQueueRunner(database, {
    pollIntervalMs
  })

  let isShuttingDown = false
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      console.log(`Received ${signal} again, forcing immediate exit...`)
      process.exit(1)
    }
    isShuttingDown = true
    console.log(`Received ${signal}. Shutting down queue worker gracefully...`)

    const forceExitTimer = setTimeout(() => {
      console.error('Graceful shutdown timed out after 30s. Forcing exit.')
      process.exit(1)
    }, 30000)
    forceExitTimer.unref()

    try {
      await runner.stop()
      console.log('Queue worker drained and stopped successfully.')
      clearTimeout(forceExitTimer)
      process.exit(0)
    } catch (error) {
      console.error('Error while stopping queue worker:', error)
      clearTimeout(forceExitTimer)
      process.exit(1)
    }
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

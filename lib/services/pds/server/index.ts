import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import { isIPv6 } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import type { Database } from '@/lib/database/types'
import {
  ensureServedDomainsFresh,
  isServedDomainSnapshotFresh,
  refreshServedDomains,
  startServedDomainRefresher
} from '@/lib/services/domains/servedDomainSnapshot'
import { startPdsCrawlRequests } from '@/lib/services/pds/requestCrawl'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import {
  createPdsFirehoseUpgradeHandler,
  handlePdsServerUpgrade
} from './upgrade'

interface RequiredServerFilesManifest {
  config?: Record<string, unknown>
}

const formatHostname = (hostname: string): string =>
  isIPv6(hostname) ? `[${hostname}]` : hostname

const parseKeepAliveTimeout = (
  value: string | undefined
): number | undefined => {
  const parsed = parseInt(value ?? '', 10)
  if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed < 0) {
    return undefined
  }
  return parsed
}

const loadStandaloneNextConfig = (
  serverDir: string
): Record<string, unknown> => {
  const manifestPath = path.join(
    serverDir,
    '.next',
    'required-server-files.json'
  )
  const raw = fs.readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as RequiredServerFilesManifest
  const config = manifest.config ?? {}
  return {
    ...config,
    distDir: './.next'
  }
}

const main = async (): Promise<void> => {
  const serverDir = path.dirname(fileURLToPath(import.meta.url))

  ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
  process.chdir(serverDir)

  let port = parseInt(process.env.PORT ?? '', 10) || 3000
  const hostname = process.env.HOSTNAME || '0.0.0.0'
  const keepAliveTimeout = parseKeepAliveTimeout(process.env.KEEP_ALIVE_TIMEOUT)

  const nextConfig = loadStandaloneNextConfig(serverDir)
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)

  const { default: next } = await import('next')

  // Pass a throwaway EventEmitter as `httpServer` so Next attaches its lazy
  // custom-server upgrade listener there instead of our real http.Server.
  // pds-server.js runs with `dev: false` and no WebSocket rewrites, so Next's
  // router upgrade handler would leave unmatched sockets open.
  const nextUpgradeTarget = new EventEmitter() as unknown as http.Server

  const app = next({
    dev: false,
    dir: serverDir,
    hostname,
    port,
    conf: nextConfig,
    httpServer: nextUpgradeTarget
  })

  await app.prepare()

  // The PDS server opens its own database pool through `getDatabase()` beside
  // Next's bundled one, because `pds-server.js` and Next's server bundle do
  // not share module instances.
  let ownDatabase: Database | null = null
  const getFirehoseDatabase = (): Database | null => {
    if (!ownDatabase) {
      ownDatabase = getDatabase()
    }
    return ownDatabase
  }

  // Ensure the served-domain snapshot is fresh before accepting WebSocket
  // upgrades so PDS host validation does not fail closed during startup.
  await ensureServedDomainsFresh()
  if (!isServedDomainSnapshotFresh()) {
    const db = getFirehoseDatabase()
    if (db) {
      startServedDomainRefresher(db)
      await refreshServedDomains(db)
    }
  }

  const handle = app.getRequestHandler()
  const firehose = createPdsFirehoseUpgradeHandler({
    getDatabase: getFirehoseDatabase
  })

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      logger.error({
        message: 'Unhandled error in Next request handler',
        err: toLoggableError(error),
        url: req.url
      })
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    })
  })

  if (keepAliveTimeout) {
    server.keepAliveTimeout = keepAliveTimeout
  }

  server.on('upgrade', (req, socket, head) =>
    handlePdsServerUpgrade(firehose, req, socket, head)
  )

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, hostname, () => {
      server.off('error', reject)
      const addr = server.address()
      const actualHostname = formatHostname(
        typeof addr === 'object'
          ? addr?.address || hostname || 'localhost'
          : addr
      )
      const formattedHostname =
        !hostname || actualHostname === '0.0.0.0'
          ? 'localhost'
          : actualHostname === '[::]'
            ? '[::1]'
            : formatHostname(hostname)
      port = typeof addr === 'object' ? addr?.port || port : port
      process.env.PORT = `${port}`
      process.env.__NEXT_PRIVATE_ORIGIN = `http://${formattedHostname}:${port}`
      resolve()
    })
  })

  logger.info({ message: 'PDS server listening', hostname, port })

  const stopCrawlRequests = startPdsCrawlRequests(
    getConfig().blueskyPds ?? null
  )

  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ message: 'Shutting down PDS server', signal })

    stopCrawlRequests()

    const forceExitTimer = setTimeout(() => {
      logger.error({ message: 'Timed out shutting down PDS server', signal })
      process.exit(1)
    }, 10_000)
    forceExitTimer.unref()

    void (async () => {
      try {
        const serverClosed = new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
        await firehose.close()
        server.closeIdleConnections()
        await serverClosed
        await app.close()
        if (ownDatabase) {
          await ownDatabase.destroy()
        }
      } catch (error) {
        logger.error({
          message: 'Error while shutting down PDS server',
          err: toLoggableError(error),
          signal
        })
        process.exit(1)
      } finally {
        clearTimeout(forceExitTimer)
      }
      process.exit(0)
    })()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  logger.error({
    message: 'Failed to start PDS server',
    err: toLoggableError(error)
  })
  process.exit(1)
})

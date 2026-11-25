import { getConfig } from '@/lib/config'
import type { DatabaseConfig } from '@/lib/config/database'
import {
  createPostgresClient,
  describeError,
  getDatabaseBackend
} from '@/lib/database/connection'
import type { Database } from '@/lib/database/types'
import { PDS_EVENTS_NOTIFY_CHANNEL } from '@/lib/services/pds/constants'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export const PDS_FIREHOSE_POLL_INTERVAL_MS = 1_000
export const PDS_FIREHOSE_PG_INITIAL_RECONNECT_MS = 1_000
export const PDS_FIREHOSE_PG_MAX_RECONNECT_MS = 30_000
export const PDS_FIREHOSE_PG_CONNECT_TIMEOUT_MS = 10_000

const PG_CHANNEL_PATTERN = /^[a-z_][a-z0-9_]*$/i

export interface PdsEventSource {
  subscribe(listener: () => void): () => void
  close(): Promise<void>
}

export interface PgListenClient {
  connect(): Promise<unknown>
  query(sql: string): Promise<unknown>
  end(): Promise<unknown>
  on(
    event: 'notification',
    listener: (msg: { channel: string; payload?: string }) => void
  ): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'end', listener: () => void): unknown
}

export type CreatePollingPdsEventSourceOptions = {
  intervalMs?: number
}

export type CreatePostgresPdsEventSourceOptions = {
  createClient: () => Promise<PgListenClient>
  channel?: string
  initialReconnectDelayMs?: number
  maxReconnectDelayMs?: number
}

export type CreatePdsEventSourceOptions = {
  databaseConfig?: DatabaseConfig
  createClient?: () => Promise<PgListenClient>
  pollIntervalMs?: number
  initialReconnectDelayMs?: number
  maxReconnectDelayMs?: number
}

const notifyAll = (listeners: Set<() => void>): void => {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      logger.error(
        { err: toLoggableError(error) },
        'PDS firehose event source listener threw an error'
      )
    }
  }
}

export const createPollingPdsEventSource = ({
  intervalMs = PDS_FIREHOSE_POLL_INTERVAL_MS
}: CreatePollingPdsEventSourceOptions = {}): PdsEventSource => {
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  let closed = false

  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const ensureTimer = (): void => {
    if (closed || timer !== null || listeners.size === 0) return
    timer = setInterval(() => {
      if (closed) return
      notifyAll(listeners)
    }, intervalMs)
    timer.unref?.()
  }

  return {
    subscribe(listener) {
      if (closed) return () => {}
      listeners.add(listener)
      ensureTimer()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          stopTimer()
        }
      }
    },
    async close() {
      if (closed) return
      closed = true
      listeners.clear()
      stopTimer()
    }
  }
}

const safeEndClient = async (client: PgListenClient): Promise<void> => {
  try {
    await client.end()
  } catch {
    // Ignore errors when closing an already-broken client.
  }
}

export const createPostgresPdsEventSource = ({
  createClient,
  channel = PDS_EVENTS_NOTIFY_CHANNEL,
  initialReconnectDelayMs = PDS_FIREHOSE_PG_INITIAL_RECONNECT_MS,
  maxReconnectDelayMs = PDS_FIREHOSE_PG_MAX_RECONNECT_MS
}: CreatePostgresPdsEventSourceOptions): PdsEventSource => {
  if (!PG_CHANNEL_PATTERN.test(channel)) {
    throw new Error(`Invalid PostgreSQL LISTEN channel name: ${channel}`)
  }

  const listeners = new Set<() => void>()
  const endPromises = new WeakMap<PgListenClient, Promise<void>>()
  let closed = false
  let activeClient: PgListenClient | null = null
  let connectingClient: PgListenClient | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let inFlightConnect: Promise<void> | null = null
  let connecting = false
  let attempt = 0

  const endClientOnce = (client: PgListenClient): Promise<void> => {
    let promise = endPromises.get(client)
    if (!promise) {
      promise = safeEndClient(client)
      endPromises.set(client, promise)
    }
    return promise
  }

  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const scheduleReconnect = (): void => {
    if (
      closed ||
      reconnectTimer !== null ||
      connecting ||
      activeClient !== null
    ) {
      return
    }
    const delayMs = Math.min(
      initialReconnectDelayMs * 2 ** attempt,
      maxReconnectDelayMs
    )
    attempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      startConnect()
    }, delayMs)
    reconnectTimer.unref?.()
  }

  const connectOnce = async (): Promise<void> => {
    if (closed) return

    let client: PgListenClient | null = null
    let disconnected = false

    const handleDisconnect = (reason: string, error?: unknown): void => {
      if (disconnected) return
      disconnected = true
      if (client && activeClient === client) {
        activeClient = null
      }
      if (client && connectingClient === client) {
        connectingClient = null
      }
      if (closed) return
      if (error !== undefined) {
        logger.error({
          message: `PostgreSQL PDS event listener ${reason}; scheduling reconnect`,
          err: describeError(toLoggableError(error)),
          channel
        })
      } else {
        logger.warn({
          message: `PostgreSQL PDS event listener ${reason}; scheduling reconnect`,
          channel
        })
      }
      if (client) {
        void endClientOnce(client)
      }
      // If a connect attempt is still in flight, startConnect()'s finally
      // schedules the reconnect once it settles so the timer can never fire
      // into an in-flight connect and silently wedge.
      if (!connecting) {
        scheduleReconnect()
      }
    }

    try {
      client = await createClient()
      if (closed) {
        await endClientOnce(client)
        return
      }
      connectingClient = client

      client.on('notification', (msg) => {
        if (closed || disconnected) return
        if (msg.channel === channel) {
          notifyAll(listeners)
        }
      })
      client.on('error', (error) => {
        handleDisconnect('errored', error)
      })
      client.on('end', () => {
        handleDisconnect('ended unexpectedly')
      })

      await client.connect()
      if (closed || disconnected) {
        await endClientOnce(client)
        return
      }

      await client.query(`LISTEN ${channel}`)
      if (closed || disconnected) {
        await endClientOnce(client)
        return
      }

      if (connectingClient === client) {
        connectingClient = null
      }
      activeClient = client
      attempt = 0

      // Always wake listeners once LISTEN is active (including on first
      // connect) so a subscriber that read bounds before LISTEN completed
      // catches up on any event committed in the startup window.
      notifyAll(listeners)
    } catch (error) {
      handleDisconnect('failed to connect', error)
    } finally {
      if (client !== null && connectingClient === client) {
        connectingClient = null
      }
    }
  }

  const startConnect = (): void => {
    if (closed || connecting || activeClient !== null) return
    clearReconnectTimer()
    connecting = true
    const promise = connectOnce().finally(() => {
      connecting = false
      if (inFlightConnect === promise) {
        inFlightConnect = null
      }
      if (!closed && activeClient === null) {
        scheduleReconnect()
      }
    })
    inFlightConnect = promise
  }

  startConnect()

  return {
    subscribe(listener) {
      if (closed) return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async close() {
      if (closed) return
      closed = true
      listeners.clear()
      clearReconnectTimer()
      const active = activeClient
      activeClient = null
      const pending = connectingClient
      connectingClient = null
      if (active) {
        await endClientOnce(active)
      }
      if (pending && pending !== active) {
        await endClientOnce(pending)
      }
      if (inFlightConnect) {
        await inFlightConnect
      }
    }
  }
}

export const createPdsEventSource = (
  _database: Database,
  options: CreatePdsEventSourceOptions = {}
): PdsEventSource => {
  const config = options.databaseConfig ?? getConfig().database

  if (getDatabaseBackend(config) === 'pg' && config.client === 'pg') {
    if (options.createClient) {
      return createPostgresPdsEventSource({
        createClient: options.createClient,
        initialReconnectDelayMs: options.initialReconnectDelayMs,
        maxReconnectDelayMs: options.maxReconnectDelayMs
      })
    }

    return createPostgresPdsEventSource({
      createClient: () =>
        createPostgresClient(config, {
          connectionTimeoutMillis: PDS_FIREHOSE_PG_CONNECT_TIMEOUT_MS
        }),
      initialReconnectDelayMs: options.initialReconnectDelayMs,
      maxReconnectDelayMs: options.maxReconnectDelayMs
    })
  }

  return createPollingPdsEventSource({
    intervalMs: options.pollIntervalMs
  })
}

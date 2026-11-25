import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'

import type { BlueskyPdsDomainConfig } from '@/lib/config/blueskyPds'
import type { Database } from '@/lib/database/types'
import {
  type PdsFirehoseConnectionLimiter,
  createPdsFirehoseConnectionLimiter
} from '@/lib/services/pds/firehose/limits'
import {
  type PdsEventSource,
  createPdsEventSource
} from '@/lib/services/pds/firehose/source'
import {
  type PdsFirehoseTransport,
  createPdsFirehoseSubscriber
} from '@/lib/services/pds/firehose/subscriber'
import { getPdsDomainForRequest } from '@/lib/services/pds/host'
import { getTrustedClientRateLimitKey } from '@/lib/utils/getTrustedClientIp'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export const PDS_FIREHOSE_SUBSCRIBE_PATH =
  '/xrpc/com.atproto.sync.subscribeRepos'
export const PDS_FIREHOSE_PING_INTERVAL_MS = 30_000
export const PDS_FIREHOSE_MAX_MISSED_PONGS = 2
export const PDS_FIREHOSE_MAX_PAYLOAD_BYTES = 4 * 1024

const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/

export interface PdsFirehoseUpgradeHandlerOptions {
  getDatabase: () => Database | null
  eventSource?: PdsEventSource
  limiter?: PdsFirehoseConnectionLimiter
  pingIntervalMs?: number
  maxMissedPongs?: number
  pageSize?: number
  maxBufferedBytes?: number
  resolvePdsDomain?: (headers: Headers) => BlueskyPdsDomainConfig | null
  getClientRateLimitKey?: (headers: Headers) => string | undefined
}

export interface PdsFirehoseUpgradeHandler {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean
  close(): Promise<void>
}

const toWebHeaders = (headers: IncomingMessage['headers']): Headers => {
  const result = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const entry of value) {
        result.append(key, entry)
      }
    } else {
      result.set(key, value)
    }
  }
  return result
}

const parseSubscribeReposUrl = (rawUrl: string | undefined): URL | null => {
  if (!rawUrl || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) {
    return null
  }
  const queryStart = rawUrl.indexOf('?')
  const hashStart = rawUrl.indexOf('#')
  let pathEnd = rawUrl.length
  if (queryStart !== -1 && queryStart < pathEnd) pathEnd = queryStart
  if (hashStart !== -1 && hashStart < pathEnd) pathEnd = hashStart
  if (rawUrl.slice(0, pathEnd) !== PDS_FIREHOSE_SUBSCRIBE_PATH) {
    return null
  }
  try {
    return new URL(rawUrl, 'http://localhost')
  } catch {
    return null
  }
}

type ParsedCursor = { ok: true; cursor: number | undefined } | { ok: false }

const parseCursor = (searchParams: URLSearchParams): ParsedCursor => {
  const values = searchParams.getAll('cursor')
  if (values.length === 0) {
    return { ok: true, cursor: undefined }
  }
  if (values.length > 1) {
    return { ok: false }
  }
  const raw = values[0]
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(raw)) {
    return { ok: false }
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return { ok: false }
  }
  return { ok: true, cursor: parsed }
}

const rejectUpgrade = (
  socket: Duplex,
  statusCode: number,
  reasonPhrase: string,
  body = `${reasonPhrase}\n`
): void => {
  if (socket.destroyed) return
  const response = [
    `HTTP/1.1 ${statusCode} ${reasonPhrase}`,
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    'Cache-Control: no-store',
    '',
    body
  ].join('\r\n')
  socket.once('error', () => {
    socket.destroy()
  })
  socket.end(response, () => {
    socket.destroy()
  })
}

const defaultGetClientRateLimitKey = (headers: Headers): string | undefined =>
  getTrustedClientRateLimitKey({ headers } as Request)

export const createPdsFirehoseUpgradeHandler = ({
  getDatabase,
  eventSource,
  limiter = createPdsFirehoseConnectionLimiter(),
  pingIntervalMs = PDS_FIREHOSE_PING_INTERVAL_MS,
  maxMissedPongs = PDS_FIREHOSE_MAX_MISSED_PONGS,
  pageSize,
  maxBufferedBytes,
  resolvePdsDomain = (headers) => getPdsDomainForRequest(headers),
  getClientRateLimitKey = defaultGetClientRateLimitKey
}: PdsFirehoseUpgradeHandlerOptions): PdsFirehoseUpgradeHandler => {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: PDS_FIREHOSE_MAX_PAYLOAD_BYTES,
    perMessageDeflate: false
  })
  const activeSockets = new Set<WebSocket>()
  let ownedEventSource: PdsEventSource | null = null
  let closed = false

  const getOrCreateEventSource = (database: Database): PdsEventSource => {
    if (eventSource) return eventSource
    if (!ownedEventSource) {
      ownedEventSource = createPdsEventSource(database)
    }
    return ownedEventSource
  }

  const handleUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): boolean => {
    const parsedUrl = parseSubscribeReposUrl(req.url)
    if (!parsedUrl) {
      return false
    }

    if (closed) {
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return true
    }

    const headers = toWebHeaders(req.headers)
    const pdsDomain = resolvePdsDomain(headers)
    if (!pdsDomain) {
      rejectUpgrade(socket, 404, 'Not Found')
      return true
    }

    const clientKey = getClientRateLimitKey(headers) ?? null
    const releaseSlot = limiter.tryAcquire(clientKey)
    if (!releaseSlot) {
      rejectUpgrade(socket, 429, 'Too Many Requests')
      return true
    }

    const parsedCursor = parseCursor(parsedUrl.searchParams)
    if (!parsedCursor.ok) {
      releaseSlot()
      rejectUpgrade(socket, 400, 'Bad Request', 'Invalid cursor parameter\n')
      return true
    }

    const database = getDatabase()
    if (!database) {
      releaseSlot()
      rejectUpgrade(socket, 503, 'Service Unavailable')
      return true
    }

    // Ensure the limiter slot is always released even if ws rejects the
    // WebSocket handshake (e.g. missing Sec-WebSocket-Key) without calling cb.
    socket.once('close', releaseSlot)

    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (closed) {
          releaseSlot()
          ws.close(1001, 'Server shutting down')
          return
        }

        let source: PdsEventSource
        try {
          source = getOrCreateEventSource(database)
        } catch (error) {
          logger.error(
            { err: toLoggableError(error), domain: pdsDomain.domain },
            'Failed to initialize PDS firehose event source'
          )
          releaseSlot()
          ws.close(1011, 'Internal server error')
          return
        }

        activeSockets.add(ws)

        // The firehose is strictly server-to-client; ignore any client frames.
        ws.on('message', () => {})

        let pendingPings = 0
        ws.on('pong', () => {
          pendingPings = 0
        })

        const pingTimer = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return
          if (pendingPings >= maxMissedPongs) {
            ws.terminate()
            return
          }
          pendingPings += 1
          try {
            ws.ping()
          } catch {
            ws.terminate()
          }
        }, pingIntervalMs)
        pingTimer.unref?.()

        const transport: PdsFirehoseTransport = {
          send(frame) {
            if (ws.readyState !== WebSocket.OPEN) return
            ws.send(frame, { binary: true })
          },
          bufferedAmount() {
            return ws.bufferedAmount
          },
          close(code, reason) {
            if (
              ws.readyState === WebSocket.OPEN ||
              ws.readyState === WebSocket.CONNECTING
            ) {
              ws.close(code, reason)
            }
          }
        }

        const subscriber = createPdsFirehoseSubscriber({
          database,
          domain: pdsDomain.domain,
          cursor: parsedCursor.cursor,
          source,
          transport,
          pageSize,
          maxBufferedBytes
        })

        let cleanedUp = false
        const cleanup = (): void => {
          if (cleanedUp) return
          cleanedUp = true
          clearInterval(pingTimer)
          subscriber.stop()
          activeSockets.delete(ws)
          releaseSlot()
        }

        ws.once('close', cleanup)
        ws.once('error', (error) => {
          logger.warn(
            { err: toLoggableError(error), domain: pdsDomain.domain },
            'PDS firehose WebSocket error'
          )
          cleanup()
        })

        void subscriber.start()
      })
    } catch (error) {
      logger.error(
        { err: toLoggableError(error), domain: pdsDomain.domain },
        'Failed to upgrade PDS firehose WebSocket connection'
      )
      releaseSlot()
      socket.destroy()
    }

    return true
  }

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true

    for (const ws of [...activeSockets]) {
      try {
        ws.close(1001, 'Server shutting down')
      } catch {
        ws.terminate()
      }
    }
    activeSockets.clear()

    await new Promise<void>((resolve) => {
      wss.close(() => resolve())
    })

    const source = ownedEventSource
    ownedEventSource = null
    if (source) {
      await source.close()
    }
  }

  return {
    handleUpgrade,
    close
  }
}

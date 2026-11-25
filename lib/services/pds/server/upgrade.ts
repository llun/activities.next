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
  PDS_FIREHOSE_LOW_WATER_BUFFERED_BYTES,
  type PdsFirehoseTransport,
  createPdsFirehoseSubscriber
} from '@/lib/services/pds/firehose/subscriber'
import { getPdsDomainForRequest } from '@/lib/services/pds/host'
import { checkPdsSyncRateLimit } from '@/lib/services/pds/rateLimit'
import { getTrustedClientRateLimitKey } from '@/lib/utils/getTrustedClientIp'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export const PDS_FIREHOSE_SUBSCRIBE_PATH =
  '/xrpc/com.atproto.sync.subscribeRepos'
export const PDS_FIREHOSE_PING_INTERVAL_MS = 30_000
export const PDS_FIREHOSE_MAX_MISSED_PONGS = 2
export const PDS_FIREHOSE_MAX_PAYLOAD_BYTES = 4 * 1024
export const PDS_FIREHOSE_CLOSE_GRACE_MS = 2_000
export const PDS_FIREHOSE_WS_CLOSE_TIMEOUT_MS = 4_000
export const PDS_FIREHOSE_DRAIN_POLL_MS = 50
export const PDS_FIREHOSE_CONSUMER_TOO_SLOW_TERMINATE_MS = 1_000

const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/

export interface PdsFirehoseUpgradeHandlerOptions {
  getDatabase: () => Database | null
  eventSource?: PdsEventSource
  limiter?: PdsFirehoseConnectionLimiter
  pingIntervalMs?: number
  maxMissedPongs?: number
  closeGraceMs?: number
  consumerTooSlowTerminateMs?: number
  wsCloseTimeoutMs?: number
  pageSize?: number
  pageMaxBytes?: number
  lowWaterBufferedBytes?: number
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

export const rejectUpgrade = (
  socket: Duplex,
  statusCode: number,
  reasonPhrase: string,
  body = `${reasonPhrase}\n`,
  extraHeaders: string[] = []
): void => {
  if (socket.destroyed) return
  const response = [
    `HTTP/1.1 ${statusCode} ${reasonPhrase}`,
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    'Cache-Control: no-store',
    ...extraHeaders,
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
  closeGraceMs = PDS_FIREHOSE_CLOSE_GRACE_MS,
  consumerTooSlowTerminateMs = PDS_FIREHOSE_CONSUMER_TOO_SLOW_TERMINATE_MS,
  wsCloseTimeoutMs = PDS_FIREHOSE_WS_CLOSE_TIMEOUT_MS,
  pageSize,
  pageMaxBytes,
  lowWaterBufferedBytes,
  maxBufferedBytes,
  resolvePdsDomain = (headers) => getPdsDomainForRequest(headers),
  getClientRateLimitKey = defaultGetClientRateLimitKey
}: PdsFirehoseUpgradeHandlerOptions): PdsFirehoseUpgradeHandler => {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: PDS_FIREHOSE_MAX_PAYLOAD_BYTES,
    perMessageDeflate: false,
    handleProtocols: () => false,
    // ws 8.x supports closeTimeout at runtime as a backstop if a peer stalls
    // the close handshake, even though @types/ws does not declare it yet.
    closeTimeout: wsCloseTimeoutMs
  } as ConstructorParameters<typeof WebSocketServer>[0] & {
    closeTimeout: number
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

    // Ensure the limiter slot is always released even if the client disconnects
    // during the async rate-limit check or if ws rejects the handshake.
    socket.once('close', releaseSlot)
    const onPendingSocketError = (): void => {
      releaseSlot()
      socket.destroy()
    }
    socket.once('error', onPendingSocketError)

    void (async () => {
      try {
        const rateLimit = await checkPdsSyncRateLimit(
          database,
          { headers } as Request,
          'sync'
        )
        if (!rateLimit.allowed) {
          socket.off('error', onPendingSocketError)
          releaseSlot()
          rejectUpgrade(
            socket,
            429,
            'Too Many Requests',
            'Too Many Requests\n',
            rateLimit.retryAfterSeconds > 0
              ? [`Retry-After: ${rateLimit.retryAfterSeconds}`]
              : []
          )
          return
        }
      } catch (error) {
        logger.error({
          message: 'Failed to check PDS firehose upgrade rate limit',
          err: toLoggableError(error),
          domain: pdsDomain.domain
        })
        socket.off('error', onPendingSocketError)
        releaseSlot()
        rejectUpgrade(socket, 503, 'Service Unavailable')
        return
      }

      socket.off('error', onPendingSocketError)

      if (socket.destroyed || !socket.writable) {
        releaseSlot()
        return
      }

      if (closed) {
        releaseSlot()
        rejectUpgrade(socket, 503, 'Service Unavailable')
        return
      }

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
            logger.error({
              message: 'Failed to initialize PDS firehose event source',
              err: toLoggableError(error),
              domain: pdsDomain.domain
            })
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

          const effectiveLowWaterBytes =
            lowWaterBufferedBytes ?? PDS_FIREHOSE_LOW_WATER_BUFFERED_BYTES
          let slowCloseTimer: ReturnType<typeof setTimeout> | null = null

          const transport: PdsFirehoseTransport = {
            send(frame) {
              if (ws.readyState !== WebSocket.OPEN) return
              ws.send(frame, { binary: true })
            },
            bufferedAmount() {
              return ws.bufferedAmount
            },
            waitForDrain() {
              if (
                ws.readyState !== WebSocket.OPEN ||
                ws.bufferedAmount <= effectiveLowWaterBytes
              ) {
                return Promise.resolve()
              }
              return new Promise<void>((resolve) => {
                let done = false
                const rawSocket = (ws as WebSocket & { _socket?: Duplex })
                  ._socket
                const finish = (): void => {
                  if (done) return
                  done = true
                  clearInterval(pollTimer)
                  ws.off('close', finish)
                  ws.off('error', finish)
                  rawSocket?.off('drain', check)
                  resolve()
                }
                const check = (): void => {
                  if (
                    ws.readyState !== WebSocket.OPEN ||
                    ws.bufferedAmount <= effectiveLowWaterBytes
                  ) {
                    finish()
                  }
                }
                const pollTimer = setInterval(check, PDS_FIREHOSE_DRAIN_POLL_MS)
                pollTimer.unref?.()
                ws.once('close', finish)
                ws.once('error', finish)
                rawSocket?.on('drain', check)
                check()
              })
            },
            close(code, reason) {
              if (
                ws.readyState === WebSocket.OPEN ||
                ws.readyState === WebSocket.CONNECTING
              ) {
                ws.close(code, reason)
              }
              if (
                reason === 'ConsumerTooSlow' &&
                ws.readyState !== WebSocket.CLOSED &&
                slowCloseTimer === null
              ) {
                slowCloseTimer = setTimeout(() => {
                  slowCloseTimer = null
                  if (ws.readyState !== WebSocket.CLOSED) {
                    ws.terminate()
                  }
                }, consumerTooSlowTerminateMs)
                slowCloseTimer.unref?.()
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
            pageMaxBytes,
            lowWaterBufferedBytes: effectiveLowWaterBytes,
            maxBufferedBytes
          })

          let cleanedUp = false
          const cleanup = (): void => {
            if (cleanedUp) return
            cleanedUp = true
            clearInterval(pingTimer)
            if (slowCloseTimer !== null) {
              clearTimeout(slowCloseTimer)
              slowCloseTimer = null
            }
            subscriber.stop()
            activeSockets.delete(ws)
            releaseSlot()
          }

          ws.once('close', cleanup)
          ws.once('error', (error) => {
            logger.warn({
              message: 'PDS firehose WebSocket error',
              err: toLoggableError(error),
              domain: pdsDomain.domain
            })
            cleanup()
          })

          void subscriber.start()
        })
      } catch (error) {
        logger.error({
          message: 'Failed to upgrade PDS firehose WebSocket connection',
          err: toLoggableError(error),
          domain: pdsDomain.domain
        })
        releaseSlot()
        socket.destroy()
      }
    })()

    return true
  }

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true

    const socketsToClose = Array.from(
      new Set<WebSocket>([...activeSockets, ...wss.clients])
    )
    for (const ws of socketsToClose) {
      try {
        ws.close(1001, 'Server shutting down')
      } catch {
        ws.terminate()
      }
    }

    if (socketsToClose.length > 0) {
      let graceTimer: ReturnType<typeof setTimeout> | null = null
      const listeners: Array<{ ws: WebSocket; listener: () => void }> = []
      try {
        const allClosed = new Promise<void>((resolve) => {
          const checkDone = (): void => {
            if (
              socketsToClose.every((ws) => ws.readyState === WebSocket.CLOSED)
            ) {
              resolve()
            }
          }
          for (const ws of socketsToClose) {
            if (ws.readyState !== WebSocket.CLOSED) {
              ws.once('close', checkDone)
              listeners.push({ ws, listener: checkDone })
            }
          }
          checkDone()
        })
        const graceElapsed = new Promise<void>((resolve) => {
          graceTimer = setTimeout(() => {
            graceTimer = null
            for (const ws of socketsToClose) {
              if (ws.readyState !== WebSocket.CLOSED) {
                ws.terminate()
              }
            }
            resolve()
          }, closeGraceMs)
          graceTimer.unref?.()
        })
        await Promise.race([allClosed, graceElapsed])
      } finally {
        if (graceTimer !== null) {
          clearTimeout(graceTimer)
          graceTimer = null
        }
        for (const { ws, listener } of listeners) {
          ws.off('close', listener)
        }
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

/**
 * The start command's `upgrade` listener: the firehose takes its own path and
 * every other upgrade gets 404. Next's router upgrade handler is never used,
 * because it leaves sockets it has no route for open.
 */
export const handlePdsServerUpgrade = (
  firehose: Pick<PdsFirehoseUpgradeHandler, 'handleUpgrade'>,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
): void => {
  if (firehose.handleUpgrade(req, socket, head)) return
  rejectUpgrade(socket, 404, 'Not Found')
}

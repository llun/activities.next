import { decodeAll as cborDecodeAll } from '@atproto/lex-cbor'
import type { LexMap } from '@atproto/lex-data'
import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocket } from 'ws'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
import { formatPdsIdentityEvent } from '@/lib/services/pds/events'
import { createPdsFirehoseConnectionLimiter } from '@/lib/services/pds/firehose/limits'
import type { PdsEventSource } from '@/lib/services/pds/firehose/source'
import { resetPdsHostCollisionWarningsForTests } from '@/lib/services/pds/host'

import {
  PDS_FIREHOSE_SUBSCRIBE_PATH,
  type PdsFirehoseUpgradeHandler,
  type PdsFirehoseUpgradeHandlerOptions,
  createPdsFirehoseUpgradeHandler
} from './upgrade'

const TEST_DOMAIN = 'alpha.example'
const TEST_PDS_HOST = 'pds.alpha.example'
const TEST_DID = 'did:web:alice.alpha.example'

const TEST_PDS_CONFIG_JSON = JSON.stringify({
  [TEST_DOMAIN]: {
    enabled: true,
    hostname: TEST_PDS_HOST,
    allowEmails: [],
    allowActors: [],
    relays: []
  }
})

class ManualEventSource implements PdsEventSource {
  private readonly listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(): void {
    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  async close(): Promise<void> {
    this.listeners.clear()
  }
}

type DecodedFrame = {
  header: LexMap
  body: LexMap
}

const decodeFrame = (data: WebSocket.RawData): DecodedFrame => {
  const bytes = Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : data
  const [header, body] = Array.from(cborDecodeAll(bytes)) as [LexMap, LexMap]
  return { header, body }
}

const connectExpectRejection = (
  url: string,
  headers: Record<string, string>
): Promise<number> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers })
    ws.once('open', () => {
      ws.close()
      reject(new Error(`Expected upgrade rejection for ${url}, but it opened`))
    })
    ws.once('unexpected-response', (_req, res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    ws.once('error', (err) => {
      reject(err)
    })
  })

const connectWebSocket = (
  url: string,
  options: WebSocket.ClientOptions = {}
): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options)
    ws.once('open', () => resolve(ws))
    ws.once('error', (err) => reject(err))
    ws.once('unexpected-response', (_req, res) => {
      res.resume()
      reject(
        new Error(
          `Expected WebSocket open for ${url}, got HTTP ${res.statusCode}`
        )
      )
    })
  })

const closeWebSocket = (ws: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }
    ws.once('close', () => resolve())
    ws.close()
  })

describe('PDS firehose upgrade handler', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database } = testDb

  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
  const originalTrustProxy = process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
  const originalTrustProxyHeader = process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER

  let server: http.Server | null = null
  let handler: PdsFirehoseUpgradeHandler | null = null
  let fallbackCalls: string[] = []

  const startServer = async (
    options: Partial<PdsFirehoseUpgradeHandlerOptions> = {}
  ): Promise<number> => {
    fallbackCalls = []
    handler = createPdsFirehoseUpgradeHandler({
      getDatabase: () => database,
      ...options
    })

    server = http.createServer((_req, res) => {
      res.statusCode = 200
      res.end('ok')
    })

    server.on('upgrade', (req, socket, head) => {
      if (handler!.handleUpgrade(req, socket, head)) {
        return
      }
      fallbackCalls.push(req.url ?? '')
      socket.end(
        'HTTP/1.1 418 I am a teapot\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
      )
    })

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve())
    })

    return (server.address() as AddressInfo).port
  }

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await database.createPdsRepo({
      did: TEST_DID,
      actorId: `https://${TEST_DOMAIN}/users/alice`,
      domain: TEST_DOMAIN,
      signingKey: 'v1:test-key',
      signingKeyDid: 'did:key:zQ3shUpgradeTest'
    })
  })

  afterAll(async () => {
    await testDb.destroy()
    resetServedDomainsForTests()
    resetPdsHostCollisionWarningsForTests()
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
    if (originalTrustProxy === undefined) {
      delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    } else {
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = originalTrustProxy
    }
    if (originalTrustProxyHeader === undefined) {
      delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER
    } else {
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER = originalTrustProxyHeader
    }
  })

  beforeEach(async () => {
    process.env.ACTIVITIES_BLUESKY_PDS = TEST_PDS_CONFIG_JSON
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER
    resetServedDomainsForTests()
    setServedDomainsForTests([])
    resetPdsHostCollisionWarningsForTests()
    await testDb.db.deleteFrom('pds_events').execute()
  })

  afterEach(async () => {
    if (handler) {
      await handler.close()
      handler = null
    }
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()))
      server = null
    }
  })

  it('returns 404 for subscribeRepos on a non-PDS host', async () => {
    const port = await startServer({ eventSource: new ManualEventSource() })
    const status = await connectExpectRejection(
      `ws://127.0.0.1:${port}${PDS_FIREHOSE_SUBSCRIBE_PATH}`,
      { Host: 'other.example' }
    )
    expect(status).toBe(404)
    expect(fallbackCalls).toEqual([])
  })

  it('returns false and falls through to Next upgrade handler on non-subscribeRepos paths', async () => {
    const port = await startServer({ eventSource: new ManualEventSource() })

    const otherStatus = await connectExpectRejection(
      `ws://127.0.0.1:${port}/xrpc/com.atproto.sync.getRepo`,
      { Host: TEST_PDS_HOST }
    )
    expect(otherStatus).toBe(418)

    const trailingSlashStatus = await connectExpectRejection(
      `ws://127.0.0.1:${port}${PDS_FIREHOSE_SUBSCRIBE_PATH}/`,
      { Host: TEST_PDS_HOST }
    )
    expect(trailingSlashStatus).toBe(418)

    expect(fallbackCalls).toEqual([
      '/xrpc/com.atproto.sync.getRepo',
      `${PDS_FIREHOSE_SUBSCRIBE_PATH}/`
    ])
  })

  it('returns 400 on malformed cursor parameters', async () => {
    const limiter = createPdsFirehoseConnectionLimiter({
      maxPerProcess: 2,
      maxPerClient: 2
    })
    const port = await startServer({
      eventSource: new ManualEventSource(),
      limiter
    })

    for (const query of [
      'cursor=-1',
      'cursor=abc',
      'cursor=1.5',
      'cursor=',
      'cursor=1&cursor=2'
    ]) {
      const status = await connectExpectRejection(
        `ws://127.0.0.1:${port}${PDS_FIREHOSE_SUBSCRIBE_PATH}?${query}`,
        { Host: TEST_PDS_HOST }
      )
      expect(status).toBe(400)
    }

    // Rejected bad-cursor requests must never leak limiter slots.
    expect(limiter.getActiveCount()).toBe(0)
  })

  it('returns 429 when over per-client or per-process limit and releases slots on close', async () => {
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = 'true'
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER = 'x-real-ip'

    const limiter = createPdsFirehoseConnectionLimiter({
      maxPerProcess: 3,
      maxPerClient: 1
    })
    const port = await startServer({
      eventSource: new ManualEventSource(),
      limiter
    })

    const ws1 = await connectWebSocket(
      `ws://127.0.0.1:${port}${PDS_FIREHOSE_SUBSCRIBE_PATH}`,
      { headers: { Host: TEST_PDS_HOST, 'X-Real-Ip': '203.0.113.10' } }
    )

    // Same client IP exceeds maxPerClient -> 429.
    const sameClientStatus = await connectExpectRejection(
      `ws://127.0.0.1:${port}${PDS_FIREHOSE_SUBSCRIBE_PATH}`,
      { Host: TEST_PDS_HOST, 'X-Real-Ip': '203.0.113.10' }
    )
    expect(sameClientStatus).toBe(429)

    // Different client IP succeeds while under maxPerProcess.
    const ws2 = await connectWebSocket(
      `ws://127.0.0.1:${port}${PDS_FIREHOSE_SUBSCRIBE_PATH}`,
      { headers: { Host: TEST_PDS_HOST, 'X-Real-Ip': '203.0.113.11' } }
    )
    expect(limiter.getActiveCount()).toBe(2)

    await closeWebSocket(ws1)
    await vi.waitFor(() => {
      expect(limiter.getActiveCount()).toBe(1)
    })

    // First client IP can reconnect after closing.
    const ws3 = await connectWebSocket(
      `ws://127.0.0.1:${port}${PDS_FIREHOSE_SUBSCRIBE_PATH}`,
      { headers: { Host: TEST_PDS_HOST, 'X-Real-Ip': '203.0.113.10' } }
    )

    await closeWebSocket(ws2)
    await closeWebSocket(ws3)
    await vi.waitFor(() => {
      expect(limiter.getActiveCount()).toBe(0)
    })
  })

  it('streams DAG-CBOR event frames appended after connect and ignores client messages', async () => {
    const source = new ManualEventSource()
    const port = await startServer({ eventSource: source })

    const ws = await connectWebSocket(
      `ws://127.0.0.1:${port}${PDS_FIREHOSE_SUBSCRIBE_PATH}`,
      { headers: { Host: TEST_PDS_HOST } }
    )

    // Client-sent messages are ignored on this one-way stream.
    ws.send('ignored client payload')

    const framePromise = new Promise<DecodedFrame>((resolve, reject) => {
      ws.once('message', (data) => {
        try {
          resolve(decodeFrame(data))
        } catch (err) {
          reject(err)
        }
      })
      ws.once('close', () =>
        reject(new Error('WebSocket closed before frame arrived'))
      )
    })

    // Allow subscriber.start() to read initial bounds before appending live event.
    await new Promise((resolve) => setTimeout(resolve, 20))

    const appended = await database.appendPdsEvent({
      did: TEST_DID,
      type: 'identity',
      payload: formatPdsIdentityEvent({
        did: TEST_DID,
        handle: `alice.${TEST_DOMAIN}`,
        time: '2026-11-25T00:00:00.000Z'
      })
    })
    source.emit()

    const frame = await framePromise
    expect(frame.header).toEqual({ op: 1, t: '#identity' })
    expect(frame.body).toMatchObject({
      seq: appended.seq,
      did: TEST_DID,
      handle: `alice.${TEST_DOMAIN}`
    })

    await closeWebSocket(ws)
  })

  it('terminates a client that misses two pongs', async () => {
    const port = await startServer({
      eventSource: new ManualEventSource(),
      pingIntervalMs: 30,
      maxMissedPongs: 2
    })

    const ws = await connectWebSocket(
      `ws://127.0.0.1:${port}${PDS_FIREHOSE_SUBSCRIBE_PATH}`,
      {
        headers: { Host: TEST_PDS_HOST },
        autoPong: false
      }
    )

    const closed = new Promise<number>((resolve) => {
      ws.once('close', (code) => resolve(code))
    })

    const closeCode = await closed
    // Terminated sockets close abnormally (1006).
    expect(closeCode).toBe(1006)
  })

  it('backfills from cursor and lazily creates a shared event source when none is passed', async () => {
    const existing = await database.appendPdsEvent({
      did: TEST_DID,
      type: 'identity',
      payload: formatPdsIdentityEvent({
        did: TEST_DID,
        handle: `alice.${TEST_DOMAIN}`,
        time: '2026-11-25T00:00:00.000Z'
      })
    })

    // Omit eventSource to exercise lazy createPdsEventSource(database).
    const port = await startServer()

    // Attach the message listener before the socket opens so an immediate
    // backfill frame emitted in the same tick as `open` cannot be missed.
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}${PDS_FIREHOSE_SUBSCRIBE_PATH}?cursor=${existing.seq - 1}`,
      { headers: { Host: TEST_PDS_HOST } }
    )

    const frame = await new Promise<DecodedFrame>((resolve, reject) => {
      ws.once('message', (data) => {
        try {
          resolve(decodeFrame(data))
        } catch (err) {
          reject(err)
        }
      })
      ws.once('error', reject)
      ws.once('unexpected-response', (_req, res) => {
        res.resume()
        reject(new Error(`Expected WebSocket open, got HTTP ${res.statusCode}`))
      })
      ws.once('close', () =>
        reject(new Error('WebSocket closed before backfill frame arrived'))
      )
    })

    expect(frame.header).toEqual({ op: 1, t: '#identity' })
    expect(frame.body).toMatchObject({
      seq: existing.seq,
      did: TEST_DID,
      handle: `alice.${TEST_DOMAIN}`
    })

    await closeWebSocket(ws)
  })

  it('terminates a client that stalls the close handshake after the grace period so close() does not hang', async () => {
    const limiter = createPdsFirehoseConnectionLimiter({
      maxPerProcess: 4,
      maxPerClient: 4
    })
    const port = await startServer({
      eventSource: new ManualEventSource(),
      limiter,
      closeGraceMs: 50
    })

    // Open a raw upgraded socket that accepts the 101 Switching Protocols
    // handshake but never replies to server WebSocket close frames.
    const rawSocket = await new Promise<Duplex>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: PDS_FIREHOSE_SUBSCRIBE_PATH,
        headers: {
          Host: TEST_PDS_HOST,
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
          'Sec-WebSocket-Version': '13'
        }
      })
      req.once('upgrade', (_res, socket) => {
        socket.resume()
        resolve(socket)
      })
      req.once('response', (res) => {
        res.resume()
        reject(new Error(`Expected upgrade, got HTTP ${res.statusCode}`))
      })
      req.once('error', reject)
      req.end()
    })

    const socketClosed = new Promise<void>((resolve) => {
      rawSocket.once('close', () => resolve())
    })

    try {
      await vi.waitFor(() => {
        expect(limiter.getActiveCount()).toBe(1)
      })

      const activeHandler = handler!
      handler = null

      let timeoutId: ReturnType<typeof setTimeout> | null = null
      try {
        await Promise.race([
          activeHandler.close(),
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(() => {
              reject(
                new Error(
                  'firehose.close() hung waiting on stalled close handshake'
                )
              )
            }, 1_000)
          })
        ])
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId)
        }
      }

      await socketClosed
      await vi.waitFor(() => {
        expect(limiter.getActiveCount()).toBe(0)
      })
    } finally {
      rawSocket.destroy()
    }
  })
})

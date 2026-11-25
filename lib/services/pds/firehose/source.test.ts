import { EventEmitter } from 'node:events'

import { createPostgresClient } from '@/lib/database/connection'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { PDS_EVENTS_NOTIFY_CHANNEL } from '@/lib/services/pds/constants'

import {
  PDS_FIREHOSE_PG_CONNECT_TIMEOUT_MS,
  PDS_FIREHOSE_POLL_INTERVAL_MS,
  type PgListenClient,
  createPdsEventSource,
  createPollingPdsEventSource,
  createPostgresPdsEventSource
} from './source'

vi.mock('@/lib/database/connection', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/database/connection')>()
  return {
    ...actual,
    createPostgresClient: vi.fn(actual.createPostgresClient)
  }
})

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

class FakePgClient extends EventEmitter implements PgListenClient {
  connect = vi.fn(async () => {})
  query = vi.fn(async (_sql: string) => ({}))
  end = vi.fn(async () => {})

  emitNotification(channel: string, payload?: string): void {
    this.emit('notification', { channel, payload })
  }

  emitError(err: Error): void {
    this.emit('error', err)
  }

  emitEnd(): void {
    this.emit('end')
  }
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('PDS firehose event sources', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('createPollingPdsEventSource', () => {
    it('polls listeners every 1 second and stops on unsubscribe and close', async () => {
      const source = createPollingPdsEventSource()
      const listenerA = vi.fn()
      const listenerB = vi.fn()

      const unsubA = source.subscribe(listenerA)
      source.subscribe(listenerB)

      vi.advanceTimersByTime(PDS_FIREHOSE_POLL_INTERVAL_MS - 1)
      expect(listenerA).not.toHaveBeenCalled()
      expect(listenerB).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(listenerA).toHaveBeenCalledTimes(1)
      expect(listenerB).toHaveBeenCalledTimes(1)

      unsubA()
      vi.advanceTimersByTime(PDS_FIREHOSE_POLL_INTERVAL_MS)
      expect(listenerA).toHaveBeenCalledTimes(1)
      expect(listenerB).toHaveBeenCalledTimes(2)

      await source.close()
      vi.advanceTimersByTime(PDS_FIREHOSE_POLL_INTERVAL_MS * 3)
      expect(listenerB).toHaveBeenCalledTimes(2)
    })
  })

  describe('createPostgresPdsEventSource', () => {
    it('wakes listeners once when the first connect completes LISTEN', async () => {
      const client = new FakePgClient()
      const source = createPostgresPdsEventSource({
        createClient: async () => client
      })
      const listener = vi.fn()
      source.subscribe(listener)

      await flushMicrotasks()
      expect(client.connect).toHaveBeenCalledTimes(1)
      expect(client.query).toHaveBeenCalledWith(
        `LISTEN ${PDS_EVENTS_NOTIFY_CHANNEL}`
      )
      expect(listener).toHaveBeenCalledTimes(1)

      await source.close()
    })

    it('runs LISTEN pds_events and wakes listeners only on matching channel notifications', async () => {
      const client = new FakePgClient()
      const source = createPostgresPdsEventSource({
        createClient: async () => client
      })
      const listener = vi.fn()
      const unsub = source.subscribe(listener)

      await flushMicrotasks()
      expect(client.connect).toHaveBeenCalledTimes(1)
      expect(client.query).toHaveBeenCalledWith(
        `LISTEN ${PDS_EVENTS_NOTIFY_CHANNEL}`
      )
      // Initial connect wakes listeners once LISTEN is active.
      expect(listener).toHaveBeenCalledTimes(1)

      client.emitNotification('other_channel', '1')
      expect(listener).toHaveBeenCalledTimes(1)

      client.emitNotification(PDS_EVENTS_NOTIFY_CHANNEL, '42')
      expect(listener).toHaveBeenCalledTimes(2)

      unsub()
      client.emitNotification(PDS_EVENTS_NOTIFY_CHANNEL, '43')
      expect(listener).toHaveBeenCalledTimes(2)

      await source.close()
      expect(client.end).toHaveBeenCalledTimes(1)
    })

    it('reconnects with exponential backoff on error and wakes listeners once after reconnecting', async () => {
      const clients: FakePgClient[] = []
      const failConnectClient = new FakePgClient()
      failConnectClient.connect.mockRejectedValueOnce(new Error('conn refused'))

      const createClient = vi.fn(async () => {
        if (clients.length === 1) {
          clients.push(failConnectClient)
          return failConnectClient
        }
        const next = new FakePgClient()
        clients.push(next)
        return next
      })

      const source = createPostgresPdsEventSource({
        createClient,
        initialReconnectDelayMs: 1_000,
        maxReconnectDelayMs: 4_000
      })
      const listener = vi.fn()
      source.subscribe(listener)

      await flushMicrotasks()
      expect(clients).toHaveLength(1)
      expect(listener).toHaveBeenCalledTimes(1)

      // Drop first connection with an error.
      clients[0].emitError(new Error('connection terminated'))
      expect(clients[0].end).toHaveBeenCalledTimes(1)

      // First backoff is 1s; second client fails to connect.
      await vi.advanceTimersByTimeAsync(999)
      expect(createClient).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await flushMicrotasks()
      expect(createClient).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenCalledTimes(1)

      // Second backoff is 2s; third client connects and LISTENs.
      await vi.advanceTimersByTimeAsync(1_999)
      expect(createClient).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      await flushMicrotasks()
      expect(createClient).toHaveBeenCalledTimes(3)
      expect(clients[2].query).toHaveBeenCalledWith(
        `LISTEN ${PDS_EVENTS_NOTIFY_CHANNEL}`
      )
      // Reconnect wakes listeners once so nothing committed during the outage is missed.
      expect(listener).toHaveBeenCalledTimes(2)

      // Subsequent notification on the new client still delivers.
      clients[2].emitNotification(PDS_EVENTS_NOTIFY_CHANNEL, '99')
      expect(listener).toHaveBeenCalledTimes(3)

      await source.close()
      expect(clients[2].end).toHaveBeenCalledTimes(1)
    })

    it('stops reconnecting once closed', async () => {
      const client = new FakePgClient()
      const createClient = vi.fn(async () => client)
      const source = createPostgresPdsEventSource({
        createClient,
        initialReconnectDelayMs: 1_000
      })

      await flushMicrotasks()
      client.emitError(new Error('dropped'))
      await source.close()

      await vi.advanceTimersByTimeAsync(10_000)
      expect(createClient).toHaveBeenCalledTimes(1)
    })

    it('reconnects after an error emitted mid-connect when timers advance past the backoff before connect settles', async () => {
      let rejectFirstConnect!: (err: Error) => void
      const firstClient = new FakePgClient()
      firstClient.connect.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirstConnect = reject
          })
      )
      const secondClient = new FakePgClient()

      const createClient = vi
        .fn<() => Promise<PgListenClient>>()
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(secondClient)

      const source = createPostgresPdsEventSource({
        createClient,
        initialReconnectDelayMs: 1_000,
        maxReconnectDelayMs: 4_000
      })
      const listener = vi.fn()
      source.subscribe(listener)

      await flushMicrotasks()
      expect(createClient).toHaveBeenCalledTimes(1)
      expect(firstClient.connect).toHaveBeenCalledTimes(1)

      // Emit an error while firstClient.connect() is still pending, then
      // advance timers well past the 1s backoff BEFORE connect settles.
      firstClient.emitError(new Error('socket reset mid-connect'))
      await vi.advanceTimersByTimeAsync(2_000)
      expect(createClient).toHaveBeenCalledTimes(1)

      // Now let the first connect attempt settle; the finally block must
      // schedule the reconnect instead of leaving the source wedged.
      rejectFirstConnect(new Error('connect aborted'))
      await flushMicrotasks()

      await vi.advanceTimersByTimeAsync(1_000)
      await flushMicrotasks()

      expect(createClient).toHaveBeenCalledTimes(2)
      expect(secondClient.query).toHaveBeenCalledWith(
        `LISTEN ${PDS_EVENTS_NOTIFY_CHANNEL}`
      )
      expect(listener).toHaveBeenCalledTimes(1)

      secondClient.emitNotification(PDS_EVENTS_NOTIFY_CHANNEL, '101')
      expect(listener).toHaveBeenCalledTimes(2)

      await source.close()
    })

    it('ends an in-flight connecting client on close()', async () => {
      let rejectConnect!: (err: Error) => void
      const pendingClient = new FakePgClient()
      pendingClient.connect.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectConnect = reject
          })
      )
      pendingClient.end.mockImplementationOnce(async () => {
        rejectConnect(new Error('closed while connecting'))
      })

      const createClient = vi.fn(async () => pendingClient)
      const source = createPostgresPdsEventSource({
        createClient,
        initialReconnectDelayMs: 1_000
      })

      await flushMicrotasks()
      expect(pendingClient.connect).toHaveBeenCalledTimes(1)

      await source.close()
      expect(pendingClient.end).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(10_000)
      expect(createClient).toHaveBeenCalledTimes(1)
    })
  })

  describe('createPdsEventSource', () => {
    it('picks the polling source for a SQLite database', async () => {
      const testDb = createTestDatabase({ backend: 'sqlite' })
      const source = createPdsEventSource(testDb.database)
      const listener = vi.fn()
      source.subscribe(listener)

      vi.advanceTimersByTime(PDS_FIREHOSE_POLL_INTERVAL_MS)
      expect(listener).toHaveBeenCalledTimes(1)

      await source.close()
      await testDb.destroy()
    })

    it('picks the PostgreSQL LISTEN source when configured for pg', async () => {
      const client = new FakePgClient()
      const createClient = vi.fn(async () => client)
      const fakeDb = {} as Parameters<typeof createPdsEventSource>[0]

      const source = createPdsEventSource(fakeDb, {
        databaseConfig: {
          client: 'pg',
          connection: 'postgres://localhost/test'
        },
        createClient
      })
      const listener = vi.fn()
      source.subscribe(listener)

      await flushMicrotasks()
      expect(createClient).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledTimes(1)
      client.emitNotification(PDS_EVENTS_NOTIFY_CHANNEL, '7')
      expect(listener).toHaveBeenCalledTimes(2)

      await source.close()
    })

    it('passes PDS_FIREHOSE_PG_CONNECT_TIMEOUT_MS to createPostgresClient for the pg LISTEN client', async () => {
      const fakeClient = new FakePgClient()
      vi.mocked(createPostgresClient).mockResolvedValueOnce(
        fakeClient as unknown as Awaited<
          ReturnType<typeof createPostgresClient>
        >
      )

      const fakeDb = {} as Parameters<typeof createPdsEventSource>[0]
      const databaseConfig = {
        client: 'pg' as const,
        connection: 'postgres://localhost/test'
      }

      const source = createPdsEventSource(fakeDb, { databaseConfig })
      await flushMicrotasks()

      expect(createPostgresClient).toHaveBeenCalledWith(databaseConfig, {
        connectionTimeoutMillis: PDS_FIREHOSE_PG_CONNECT_TIMEOUT_MS
      })

      await source.close()
    })
  })
})

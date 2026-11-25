import { EventEmitter } from 'node:events'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { PDS_EVENTS_NOTIFY_CHANNEL } from '@/lib/services/pds/constants'

import {
  PDS_FIREHOSE_POLL_INTERVAL_MS,
  type PgListenClient,
  createPdsEventSource,
  createPollingPdsEventSource,
  createPostgresPdsEventSource
} from './source'

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
      // Clean initial connect does not emit a spurious reconnect wakeup.
      expect(listener).not.toHaveBeenCalled()

      client.emitNotification('other_channel', '1')
      expect(listener).not.toHaveBeenCalled()

      client.emitNotification(PDS_EVENTS_NOTIFY_CHANNEL, '42')
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()
      client.emitNotification(PDS_EVENTS_NOTIFY_CHANNEL, '43')
      expect(listener).toHaveBeenCalledTimes(1)

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
      expect(listener).toHaveBeenCalledTimes(0)

      // Drop first connection with an error.
      clients[0].emitError(new Error('connection terminated'))
      expect(clients[0].end).toHaveBeenCalledTimes(1)

      // First backoff is 1s; second client fails to connect.
      await vi.advanceTimersByTimeAsync(999)
      expect(createClient).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await flushMicrotasks()
      expect(createClient).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenCalledTimes(0)

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
      expect(listener).toHaveBeenCalledTimes(1)

      // Subsequent notification on the new client still delivers.
      clients[2].emitNotification(PDS_EVENTS_NOTIFY_CHANNEL, '99')
      expect(listener).toHaveBeenCalledTimes(2)

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
      client.emitNotification(PDS_EVENTS_NOTIFY_CHANNEL, '7')
      expect(listener).toHaveBeenCalledTimes(1)

      await source.close()
    })
  })
})

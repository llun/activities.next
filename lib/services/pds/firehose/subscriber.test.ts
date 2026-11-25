import { decodeAll as cborDecodeAll } from '@atproto/lex-cbor'
import type { LexMap } from '@atproto/lex-data'

import type { PdsEvent } from '@/lib/database/domains/pds/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { formatPdsIdentityEvent } from '@/lib/services/pds/events'

import type { PdsEventSource } from './source'
import {
  PDS_FIREHOSE_MAX_BUFFERED_BYTES,
  type PdsFirehoseDatabase,
  type PdsFirehoseTransport,
  createPdsFirehoseSubscriber
} from './subscriber'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

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

  listenerCount(): number {
    return this.listeners.size
  }

  async close(): Promise<void> {
    this.listeners.clear()
  }
}

type DecodedFrame = {
  header: LexMap
  body: LexMap
}

const decodeSentFrame = (frame: Uint8Array): DecodedFrame => {
  const [header, body] = Array.from(cborDecodeAll(frame)) as [LexMap, LexMap]
  return { header, body }
}

const createMockTransport = (
  getBufferedAmount: () => number = () => 0
): {
  transport: PdsFirehoseTransport
  frames: DecodedFrame[]
  closed: Array<{ code?: number; reason?: string }>
} => {
  const frames: DecodedFrame[] = []
  const closed: Array<{ code?: number; reason?: string }> = []
  const transport: PdsFirehoseTransport = {
    send(frame) {
      frames.push(decodeSentFrame(frame))
    },
    bufferedAmount: getBufferedAmount,
    close(code, reason) {
      closed.push({ code, reason })
    }
  }
  return { transport, frames, closed }
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('PDS firehose subscriber', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database } = testDb

  const domainA = 'alpha.example'
  const domainB = 'beta.example'
  const didA = 'did:web:alice.alpha.example'
  const didB = 'did:web:bob.beta.example'

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await database.createPdsRepo({
      did: didA,
      actorId: 'https://alpha.example/users/alice',
      domain: domainA,
      signingKey: 'v1:key-a',
      signingKeyDid: 'did:key:zQ3shAlpha'
    })
    await database.createPdsRepo({
      did: didB,
      actorId: 'https://beta.example/users/bob',
      domain: domainB,
      signingKey: 'v1:key-b',
      signingKeyDid: 'did:key:zQ3shBeta'
    })
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await testDb.db.deleteFrom('pds_events').execute()
  })

  const appendIdentityEvent = async (
    did: string,
    handle: string,
    createdAt?: number
  ): Promise<PdsEvent> =>
    database.appendPdsEvent({
      did,
      type: 'identity',
      payload: formatPdsIdentityEvent({
        did,
        handle,
        time: '2026-11-25T00:00:00.000Z'
      }),
      createdAt
    })

  it('streams live events only when cursor is omitted and filters out other domains', async () => {
    await appendIdentityEvent(didA, 'old.alpha.example')
    await appendIdentityEvent(didB, 'old.beta.example')

    const source = new ManualEventSource()
    const { transport, frames, closed } = createMockTransport()
    const subscriber = createPdsFirehoseSubscriber({
      database,
      domain: domainA,
      cursor: undefined,
      source,
      transport
    })

    await subscriber.start()
    expect(frames).toHaveLength(0)
    expect(closed).toHaveLength(0)

    // Event on another domain is never emitted on domainA's stream.
    await appendIdentityEvent(didB, 'live.beta.example')
    source.emit()
    await flush()
    expect(frames).toHaveLength(0)

    // Event on domainA is emitted in seq order.
    const liveA = await appendIdentityEvent(didA, 'live.alpha.example')
    source.emit()
    await flush()

    expect(frames).toHaveLength(1)
    expect(frames[0].header).toEqual({ op: 1, t: '#identity' })
    expect(frames[0].body).toMatchObject({
      seq: liveA.seq,
      did: didA,
      handle: 'live.alpha.example'
    })

    subscriber.stop()
    expect(source.listenerCount()).toBe(0)
  })

  it('backfills in pages then transitions to live with a wake-up mid-page without gaps or duplicates', async () => {
    const source = new ManualEventSource()
    const { transport, frames, closed } = createMockTransport()

    const initialEvents: PdsEvent[] = []
    for (let i = 1; i <= 5; i += 1) {
      initialEvents.push(await appendIdentityEvent(didA, `ev-${i}.alpha`))
    }
    const baseSeq = initialEvents[0].seq - 1

    // Wrap database so we can inject a live event + wake-up while page 1 is mid-flight.
    let listCalls = 0
    let inFlightReads = 0
    let maxConcurrentReads = 0
    let liveEvent: PdsEvent | null = null

    const wrappedDb: PdsFirehoseDatabase = {
      getPdsEventSeqBounds: (params) => database.getPdsEventSeqBounds(params),
      listPdsEvents: async (params) => {
        listCalls += 1
        inFlightReads += 1
        maxConcurrentReads = Math.max(maxConcurrentReads, inFlightReads)
        try {
          const result = await database.listPdsEvents(params)
          if (listCalls === 1) {
            // Insert a live event and fire wake-up while page 1 is still in flight.
            liveEvent = await appendIdentityEvent(didA, 'ev-live.alpha')
            source.emit()
            // Fire a second wake-up too to confirm single-loop coalescing.
            source.emit()
          }
          return result
        } finally {
          inFlightReads -= 1
        }
      }
    }

    const subscriber = createPdsFirehoseSubscriber({
      database: wrappedDb,
      domain: domainA,
      cursor: baseSeq,
      source,
      transport,
      pageSize: 2
    })

    await subscriber.start()
    await flush()

    expect(maxConcurrentReads).toBe(1)
    expect(closed).toHaveLength(0)

    const expectedSeqs = [
      ...initialEvents.map((e) => e.seq),
      (liveEvent as unknown as PdsEvent).seq
    ]
    const receivedSeqs = frames.map((f) => f.body.seq)
    expect(receivedSeqs).toEqual(expectedSeqs)

    subscriber.stop()
  })

  it('sends #info OutdatedCursor then streams from the oldest kept event', async () => {
    const e1 = await appendIdentityEvent(didA, 'pruned-1.alpha')
    const e2 = await appendIdentityEvent(didA, 'pruned-2.alpha')
    const e3 = await appendIdentityEvent(didA, 'kept-1.alpha')
    const e4 = await appendIdentityEvent(didA, 'kept-2.alpha')

    // Prune e1 and e2 so oldest kept is e3.
    await testDb.db
      .deleteFrom('pds_events')
      .where('seq', '<=', e2.seq)
      .execute()

    const source = new ManualEventSource()
    const { transport, frames, closed } = createMockTransport()
    const subscriber = createPdsFirehoseSubscriber({
      database,
      domain: domainA,
      cursor: e1.seq,
      source,
      transport
    })

    await subscriber.start()
    expect(closed).toHaveLength(0)
    expect(frames).toHaveLength(3)
    expect(frames[0].header).toEqual({ op: 1, t: '#info' })
    expect(frames[0].body.name).toBe('OutdatedCursor')
    expect(frames[1].body.seq).toBe(e3.seq)
    expect(frames[2].body.seq).toBe(e4.seq)

    subscriber.stop()
  })

  it('sends FutureCursor error frame and closes when cursor exceeds newest seq or log is empty', async () => {
    // Empty log with cursor > 0.
    const source1 = new ManualEventSource()
    const t1 = createMockTransport()
    const sub1 = createPdsFirehoseSubscriber({
      database,
      domain: domainA,
      cursor: 1,
      source: source1,
      transport: t1.transport
    })
    await sub1.start()
    expect(t1.frames).toHaveLength(1)
    expect(t1.frames[0].header).toEqual({ op: -1 })
    expect(t1.frames[0].body.error).toBe('FutureCursor')
    expect(t1.closed).toEqual([{ code: 1000, reason: 'FutureCursor' }])
    expect(source1.listenerCount()).toBe(0)

    // Non-empty log with cursor > newest.
    const ev = await appendIdentityEvent(didA, 'one.alpha')
    const source2 = new ManualEventSource()
    const t2 = createMockTransport()
    const sub2 = createPdsFirehoseSubscriber({
      database,
      domain: domainA,
      cursor: ev.seq + 5,
      source: source2,
      transport: t2.transport
    })
    await sub2.start()
    expect(t2.frames).toHaveLength(1)
    expect(t2.frames[0].header).toEqual({ op: -1 })
    expect(t2.frames[0].body.error).toBe('FutureCursor')
    expect(t2.closed).toEqual([{ code: 1000, reason: 'FutureCursor' }])
    expect(source2.listenerCount()).toBe(0)
  })

  it('sends ConsumerTooSlow error frame and closes when bufferedAmount exceeds 8 MiB', async () => {
    const e1 = await appendIdentityEvent(didA, 'one.alpha')
    await appendIdentityEvent(didA, 'two.alpha')

    let buffered = 0
    const source = new ManualEventSource()
    const frames: DecodedFrame[] = []
    const closed: Array<{ code?: number; reason?: string }> = []

    const transport: PdsFirehoseTransport = {
      send(frame) {
        frames.push(decodeSentFrame(frame))
        // After the first event frame is queued, simulate exceeding 8 MiB.
        if (frames.length === 1) {
          buffered = PDS_FIREHOSE_MAX_BUFFERED_BYTES + 1
        }
      },
      bufferedAmount: () => buffered,
      close(code, reason) {
        closed.push({ code, reason })
      }
    }

    const subscriber = createPdsFirehoseSubscriber({
      database,
      domain: domainA,
      cursor: e1.seq - 1,
      source,
      transport
    })

    await subscriber.start()

    expect(frames).toHaveLength(2)
    expect(frames[0].body.seq).toBe(e1.seq)
    expect(frames[1].header).toEqual({ op: -1 })
    expect(frames[1].body.error).toBe('ConsumerTooSlow')
    expect(closed).toEqual([{ code: 1000, reason: 'ConsumerTooSlow' }])
    expect(source.listenerCount()).toBe(0)
  })

  it('logs read errors and closes with 1011', async () => {
    const { logger } = await import('@/lib/utils/logger')
    const source = new ManualEventSource()
    const { transport, closed } = createMockTransport()
    const failingDb: PdsFirehoseDatabase = {
      getPdsEventSeqBounds: async () => ({ oldest: 1, newest: 5 }),
      listPdsEvents: async () => {
        throw new Error('database connection lost')
      }
    }

    const subscriber = createPdsFirehoseSubscriber({
      database: failingDb,
      domain: domainA,
      cursor: 0,
      source,
      transport
    })

    await subscriber.start()
    expect(logger.error).toHaveBeenCalled()
    expect(closed).toEqual([{ code: 1011, reason: 'Internal server error' }])
    expect(source.listenerCount()).toBe(0)
  })
})

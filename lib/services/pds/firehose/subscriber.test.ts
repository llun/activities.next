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
      getPdsEventSeqBounds: () => database.getPdsEventSeqBounds(),
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

  it('pumps an event committed while the initial bounds read is in flight', async () => {
    const initial = await appendIdentityEvent(didA, 'before-connect.alpha')

    let resolveBounds!: (bounds: {
      oldest: number | null
      newest: number | null
    }) => void
    const boundsDeferred = new Promise<{
      oldest: number | null
      newest: number | null
    }>((resolve) => {
      resolveBounds = resolve
    })

    const wrappedDb: PdsFirehoseDatabase = {
      getPdsEventSeqBounds: () => boundsDeferred,
      listPdsEvents: (params) => database.listPdsEvents(params)
    }

    const source = new ManualEventSource()
    const { transport, frames, closed } = createMockTransport()
    const subscriber = createPdsFirehoseSubscriber({
      database: wrappedDb,
      domain: domainA,
      cursor: undefined,
      source,
      transport
    })

    const startPromise = subscriber.start()
    // Subscriber must already be subscribed while bounds read is in flight.
    expect(source.listenerCount()).toBe(1)

    // An event commits and wakes the source before the bounds read resolves.
    const inWindowEvent = await appendIdentityEvent(didA, 'during-bounds.alpha')
    source.emit()

    // Bounds read returns the snapshot from before inWindowEvent committed.
    resolveBounds({ oldest: initial.seq, newest: initial.seq })
    await startPromise
    await flush()

    expect(closed).toHaveLength(0)
    expect(frames).toHaveLength(1)
    expect(frames[0].header).toEqual({ op: 1, t: '#identity' })
    expect(frames[0].body).toMatchObject({
      seq: inWindowEvent.seq,
      did: didA,
      handle: 'during-bounds.alpha'
    })

    subscriber.stop()
  })

  it('uses global seq bounds across domains so cursor=0 gets no OutdatedCursor and another domain seq gets no FutureCursor', async () => {
    // Use an isolated database so seq literally starts at 1 with nothing pruned.
    const isolated = createTestDatabase({ backend: 'sqlite' })
    await isolated.prepare()
    await isolated.database.migrate()

    try {
      await isolated.database.createPdsRepo({
        did: didA,
        actorId: 'https://alpha.example/users/alice',
        domain: domainA,
        signingKey: 'v1:key-a',
        signingKeyDid: 'did:key:zQ3shAlphaIso'
      })
      await isolated.database.createPdsRepo({
        did: didB,
        actorId: 'https://beta.example/users/bob',
        domain: domainB,
        signingKey: 'v1:key-b',
        signingKeyDid: 'did:key:zQ3shBetaIso'
      })

      const append = (did: string, handle: string) =>
        isolated.database.appendPdsEvent({
          did,
          type: 'identity',
          payload: formatPdsIdentityEvent({
            did,
            handle,
            time: '2026-11-25T00:00:00.000Z'
          })
        })

      // Domain A has seq 1-3; Domain B has no events yet.
      const a1 = await append(didA, 'a1.alpha.example')
      const a2 = await append(didA, 'a2.alpha.example')
      const a3 = await append(didA, 'a3.alpha.example')
      expect([a1.seq, a2.seq, a3.seq]).toEqual([1, 2, 3])

      // A domain B subscriber at cursor=3 (domain A's seq) gets no FutureCursor
      // even before domain B has any events of its own.
      const sourceBeforeB = new ManualEventSource()
      const tBeforeB = createMockTransport()
      const subBeforeB = createPdsFirehoseSubscriber({
        database: isolated.database,
        domain: domainB,
        cursor: 3,
        source: sourceBeforeB,
        transport: tBeforeB.transport
      })
      await subBeforeB.start()
      expect(tBeforeB.closed).toHaveLength(0)
      expect(tBeforeB.frames).toHaveLength(0)
      subBeforeB.stop()

      // Domain B now gets seq 4-6; nothing has been pruned.
      const b1 = await append(didB, 'b1.beta.example')
      const b2 = await append(didB, 'b2.beta.example')
      const b3 = await append(didB, 'b3.beta.example')
      expect([b1.seq, b2.seq, b3.seq]).toEqual([4, 5, 6])

      // A domain B subscriber with cursor=0 gets NO OutdatedCursor and receives 4-6.
      const sourceZero = new ManualEventSource()
      const tZero = createMockTransport()
      const subZero = createPdsFirehoseSubscriber({
        database: isolated.database,
        domain: domainB,
        cursor: 0,
        source: sourceZero,
        transport: tZero.transport
      })
      await subZero.start()
      expect(tZero.closed).toHaveLength(0)
      expect(tZero.frames.map((f) => f.header)).toEqual([
        { op: 1, t: '#identity' },
        { op: 1, t: '#identity' },
        { op: 1, t: '#identity' }
      ])
      expect(tZero.frames.map((f) => f.body.seq)).toEqual([4, 5, 6])
      subZero.stop()

      // A domain B subscriber with cursor=3 (A's seq) gets NO FutureCursor and receives 4-6.
      const sourceThree = new ManualEventSource()
      const tThree = createMockTransport()
      const subThree = createPdsFirehoseSubscriber({
        database: isolated.database,
        domain: domainB,
        cursor: 3,
        source: sourceThree,
        transport: tThree.transport
      })
      await subThree.start()
      expect(tThree.closed).toHaveLength(0)
      expect(tThree.frames.map((f) => f.header)).toEqual([
        { op: 1, t: '#identity' },
        { op: 1, t: '#identity' },
        { op: 1, t: '#identity' }
      ])
      expect(tThree.frames.map((f) => f.body.seq)).toEqual([4, 5, 6])
      subThree.stop()
    } finally {
      await isolated.destroy()
    }
  })
})

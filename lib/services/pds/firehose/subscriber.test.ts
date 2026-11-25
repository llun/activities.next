import { decodeAll as cborDecodeAll } from '@atproto/lex-cbor'
import type { LexMap } from '@atproto/lex-data'

import type { PdsEvent } from '@/lib/database/domains/pds/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  formatPdsAccountEvent,
  formatPdsIdentityEvent
} from '@/lib/services/pds/events'
import { TEST_PASSWORD_HASH } from '@/lib/stub/const'

import type { PdsEventSource } from './source'
import {
  PDS_FIREHOSE_DRAIN_TIMEOUT_MS,
  PDS_FIREHOSE_LOW_WATER_BUFFERED_BYTES,
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
    await database.createAccount({
      email: `alice@${domainA}`,
      username: 'alice',
      passwordHash: TEST_PASSWORD_HASH,
      domain: domainA,
      privateKey: 'priv-alice',
      publicKey: 'pub-alice'
    })
    await database.createAccount({
      email: `bob@${domainB}`,
      username: 'bob',
      passwordHash: TEST_PASSWORD_HASH,
      domain: domainB,
      privateKey: 'priv-bob',
      publicKey: 'pub-bob'
    })
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

  it('does not close at exactly MAX buffered bytes and sends ConsumerTooSlow at MAX + 1', async () => {
    const e1 = await appendIdentityEvent(didA, 'one.alpha')
    const e2 = await appendIdentityEvent(didA, 'two.alpha')

    // At exactly PDS_FIREHOSE_MAX_BUFFERED_BYTES: no error frame and no close.
    let exactBuffered = 0
    const exactSource = new ManualEventSource()
    const exactFrames: DecodedFrame[] = []
    const exactClosed: Array<{ code?: number; reason?: string }> = []
    const exactTransport: PdsFirehoseTransport = {
      send(frame) {
        exactFrames.push(decodeSentFrame(frame))
        exactBuffered = PDS_FIREHOSE_MAX_BUFFERED_BYTES
      },
      bufferedAmount: () => exactBuffered,
      close(code, reason) {
        exactClosed.push({ code, reason })
      }
    }

    const exactSubscriber = createPdsFirehoseSubscriber({
      database,
      domain: domainA,
      cursor: e1.seq - 1,
      source: exactSource,
      transport: exactTransport
    })
    await exactSubscriber.start()
    expect(exactClosed).toEqual([])
    expect(exactFrames.map((f) => f.body.seq)).toEqual([e1.seq, e2.seq])
    exactSubscriber.stop()

    // At PDS_FIREHOSE_MAX_BUFFERED_BYTES + 1: sends ConsumerTooSlow and closes.
    let overBuffered = 0
    const overSource = new ManualEventSource()
    const overFrames: DecodedFrame[] = []
    const overClosed: Array<{ code?: number; reason?: string }> = []

    const overTransport: PdsFirehoseTransport = {
      send(frame) {
        overFrames.push(decodeSentFrame(frame))
        if (overFrames.length === 1) {
          overBuffered = PDS_FIREHOSE_MAX_BUFFERED_BYTES + 1
        }
      },
      bufferedAmount: () => overBuffered,
      close(code, reason) {
        overClosed.push({ code, reason })
      }
    }

    const overSubscriber = createPdsFirehoseSubscriber({
      database,
      domain: domainA,
      cursor: e1.seq - 1,
      source: overSource,
      transport: overTransport
    })

    await overSubscriber.start()

    expect(overFrames).toHaveLength(2)
    expect(overFrames[0].body.seq).toBe(e1.seq)
    expect(overFrames[1].header).toEqual({ op: -1 })
    expect(overFrames[1].body.error).toBe('ConsumerTooSlow')
    expect(overClosed).toEqual([{ code: 1000, reason: 'ConsumerTooSlow' }])
    expect(overSource.listenerCount()).toBe(0)
  })

  it('pauses sending while bufferedAmount exceeds the 1 MiB low-water mark and resumes after drain', async () => {
    const e1 = await appendIdentityEvent(didA, 'drain-1.alpha')
    const e2 = await appendIdentityEvent(didA, 'drain-2.alpha')
    const e3 = await appendIdentityEvent(didA, 'drain-3.alpha')

    let buffered = 0
    let drainCalls = 0
    let resolveDrain: (() => void) | null = null
    const frames: DecodedFrame[] = []
    const closed: Array<{ code?: number; reason?: string }> = []

    const transport: PdsFirehoseTransport = {
      send(frame) {
        frames.push(decodeSentFrame(frame))
        // After sending e1, push bufferedAmount above the 1 MiB low-water mark
        // (but below the 8 MiB ConsumerTooSlow hard cutoff).
        if (frames.length === 1) {
          buffered = PDS_FIREHOSE_LOW_WATER_BUFFERED_BYTES + 1
        }
      },
      bufferedAmount: () => buffered,
      waitForDrain() {
        drainCalls += 1
        return new Promise<void>((resolve) => {
          resolveDrain = resolve
        })
      },
      close(code, reason) {
        closed.push({ code, reason })
      }
    }

    const source = new ManualEventSource()
    const subscriber = createPdsFirehoseSubscriber({
      database,
      domain: domainA,
      cursor: e1.seq - 1,
      source,
      transport
    })

    const startPromise = subscriber.start()
    await vi.waitFor(() => {
      expect(drainCalls).toBe(1)
    })

    // e1 was sent; e2 must wait until bufferedAmount drops and waitForDrain resolves.
    expect(frames.map((f) => f.body.seq)).toEqual([e1.seq])
    expect(closed).toEqual([])

    buffered = PDS_FIREHOSE_LOW_WATER_BUFFERED_BYTES
    resolveDrain!()
    await startPromise

    expect(closed).toEqual([])
    expect(frames.map((f) => f.body.seq)).toEqual([e1.seq, e2.seq, e3.seq])
    subscriber.stop()
  })

  it('closes with ConsumerTooSlow when waitForDrain times out while bufferedAmount remains above the low-water mark', async () => {
    expect(PDS_FIREHOSE_DRAIN_TIMEOUT_MS).toBe(60_000)

    const e1 = await appendIdentityEvent(didA, 'stall-1.alpha')
    const e2 = await appendIdentityEvent(didA, 'stall-2.alpha')

    vi.useFakeTimers()
    try {
      let buffered = 0
      let drainCalls = 0
      const frames: DecodedFrame[] = []
      const closed: Array<{ code?: number; reason?: string }> = []

      const transport: PdsFirehoseTransport = {
        send(frame) {
          frames.push(decodeSentFrame(frame))
          if (frames.length === 1) {
            buffered = PDS_FIREHOSE_LOW_WATER_BUFFERED_BYTES + 1
          }
        },
        bufferedAmount: () => buffered,
        waitForDrain() {
          drainCalls += 1
          return new Promise<void>(() => {
            // Intentionally never resolves to simulate a stalled consumer.
          })
        },
        close(code, reason) {
          closed.push({ code, reason })
        }
      }

      const source = new ManualEventSource()
      const subscriber = createPdsFirehoseSubscriber({
        database,
        domain: domainA,
        cursor: e1.seq - 1,
        source,
        transport,
        drainTimeoutMs: 500
      })

      const startPromise = subscriber.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(drainCalls).toBe(1)
      expect(frames.map((f) => f.body.seq)).toEqual([e1.seq])
      expect(closed).toEqual([])

      // Still waiting just before the drain timeout expires.
      await vi.advanceTimersByTimeAsync(499)
      expect(closed).toEqual([])
      expect(frames).toHaveLength(1)

      // Once the drain timeout elapses while still above low-water, close as ConsumerTooSlow.
      await vi.advanceTimersByTimeAsync(1)

      expect(frames).toHaveLength(2)
      expect(frames[0].body.seq).toBe(e1.seq)
      expect(frames[1].header).toEqual({ op: -1 })
      expect(frames[1].body.error).toBe('ConsumerTooSlow')
      expect(closed).toEqual([{ code: 1000, reason: 'ConsumerTooSlow' }])
      expect(source.listenerCount()).toBe(0)
      expect(e2.seq).toBeGreaterThan(e1.seq)
      await startPromise
    } finally {
      vi.useRealTimers()
    }
  })

  it('advances lastSeq on empty pages so a quiet domain does not rescan other-domain events on every wake-up', async () => {
    const initialA = await appendIdentityEvent(didA, 'init-a.alpha.example')

    const afterSeqsSeen: Array<number | undefined> = []
    const wrappedDb: PdsFirehoseDatabase = {
      getPdsEventSeqBounds: () => database.getPdsEventSeqBounds(),
      listPdsEvents: async (params) => {
        afterSeqsSeen.push(params?.afterSeq)
        return database.listPdsEvents(params)
      }
    }

    const source = new ManualEventSource()
    const { transport, frames, closed } = createMockTransport()
    const subscriber = createPdsFirehoseSubscriber({
      database: wrappedDb,
      domain: domainB,
      cursor: undefined,
      source,
      transport
    })

    await subscriber.start()
    expect(frames).toHaveLength(0)

    // Domain A emits events while domain B stays quiet.
    await appendIdentityEvent(didA, 'a-1.alpha.example')
    const latestA = await appendIdentityEvent(didA, 'a-2.alpha.example')
    source.emit()
    await flush()

    expect(frames).toHaveLength(0)
    expect(afterSeqsSeen).toEqual([initialA.seq])

    // Another domain A event triggers a wake-up; the next page query must start
    // after latestA.seq rather than re-scanning from initialA.seq.
    const newerA = await appendIdentityEvent(didA, 'a-3.alpha.example')
    source.emit()
    await flush()

    expect(frames).toHaveLength(0)
    expect(afterSeqsSeen).toEqual([initialA.seq, latestA.seq])

    // A subsequent domain B event is still delivered cleanly.
    const liveB = await appendIdentityEvent(didB, 'b-1.beta.example')
    source.emit()
    await flush()

    expect(closed).toEqual([])
    expect(afterSeqsSeen.slice(0, 3)).toEqual([
      initialA.seq,
      latestA.seq,
      newerA.seq
    ])
    expect(frames).toHaveLength(1)
    expect(frames[0].header).toEqual({ op: 1, t: '#identity' })
    expect(frames[0].body).toMatchObject({
      seq: liveB.seq,
      did: didB,
      handle: 'b-1.beta.example'
    })

    subscriber.stop()
  })

  it('splits large payloads across multiple byte-budgeted pages with at least one row per page', async () => {
    const bigPayload = (tag: string, padLen: number) =>
      formatPdsIdentityEvent({
        did: didA,
        handle: `${tag}.${'a'.repeat(padLen)}.alpha.example`,
        time: '2026-11-25T00:00:00.000Z'
      })

    const e1 = await database.appendPdsEvent({
      did: didA,
      type: 'identity',
      payload: bigPayload('one', 600)
    })
    const e2 = await database.appendPdsEvent({
      did: didA,
      type: 'identity',
      payload: bigPayload('two', 600)
    })
    // Single payload larger than pageMaxBytes (1000 bytes) must still be emitted alone.
    const e3 = await database.appendPdsEvent({
      did: didA,
      type: 'identity',
      payload: bigPayload('oversized', 1_200)
    })
    const e4 = await database.appendPdsEvent({
      did: didA,
      type: 'identity',
      payload: bigPayload('four', 600)
    })

    const pageSizesSeen: number[] = []
    const wrappedDb: PdsFirehoseDatabase = {
      getPdsEventSeqBounds: () => database.getPdsEventSeqBounds(),
      listPdsEvents: async (params) => {
        const result = await database.listPdsEvents(params)
        if (result.length > 0) {
          pageSizesSeen.push(result.length)
        }
        return result
      }
    }

    const source = new ManualEventSource()
    const { transport, frames, closed } = createMockTransport()
    const subscriber = createPdsFirehoseSubscriber({
      database: wrappedDb,
      domain: domainA,
      cursor: e1.seq - 1,
      source,
      transport,
      pageSize: 100,
      pageMaxBytes: 1_000
    })

    await subscriber.start()
    expect(closed).toEqual([])
    // Each payload is ~700–1300 bytes vs 1000-byte budget -> 4 pages of 1 row each.
    expect(pageSizesSeen).toEqual([1, 1, 1, 1])
    expect(frames.map((f) => f.body.seq)).toEqual([
      e1.seq,
      e2.seq,
      e3.seq,
      e4.seq
    ])
    subscriber.stop()
  })

  it('streams identity and account events for inactive repos while excluding other events', async () => {
    const inactiveDid = 'did:web:suspended.alpha.example'
    await database.createAccount({
      email: `susp@${domainA}`,
      username: 'susp',
      passwordHash: TEST_PASSWORD_HASH,
      domain: domainA,
      privateKey: 'priv-susp',
      publicKey: 'pub-susp'
    })
    const suspActorId = `https://${domainA}/users/susp`
    await database.createPdsRepo({
      did: inactiveDid,
      actorId: suspActorId,
      domain: domainA,
      signingKey: 'v1:key-susp',
      signingKeyDid: 'did:key:zQ3shSusp'
    })
    await testDb.db
      .updateTable('actors')
      .set({ suspendedAt: new Date() })
      .where('id', '=', suspActorId)
      .execute()

    const activeEvt = await appendIdentityEvent(didA, 'active.alpha.example')
    const inactiveIdentityEvt = await appendIdentityEvent(
      inactiveDid,
      'hidden.alpha.example'
    )
    const accountEvt = await database.appendPdsEvent({
      did: inactiveDid,
      type: 'account',
      payload: formatPdsAccountEvent({
        did: inactiveDid,
        active: false,
        status: 'takendown',
        time: '2026-11-25T00:00:00.000Z'
      })
    })

    const source = new ManualEventSource()
    const { transport, frames, closed } = createMockTransport()
    const subscriber = createPdsFirehoseSubscriber({
      database,
      domain: domainA,
      cursor: activeEvt.seq - 1,
      source,
      transport
    })

    await subscriber.start()
    expect(closed).toEqual([])
    expect(frames.map((f) => f.header)).toEqual([
      { op: 1, t: '#identity' },
      { op: 1, t: '#identity' },
      { op: 1, t: '#account' }
    ])
    expect(frames.map((f) => f.body.seq)).toEqual([
      activeEvt.seq,
      inactiveIdentityEvt.seq,
      accountEvt.seq
    ])
    subscriber.stop()
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
      await isolated.database.createAccount({
        email: `alice@${domainA}`,
        username: 'alice',
        passwordHash: TEST_PASSWORD_HASH,
        domain: domainA,
        privateKey: 'priv-alice-iso',
        publicKey: 'pub-alice-iso'
      })
      await isolated.database.createAccount({
        email: `bob@${domainB}`,
        username: 'bob',
        passwordHash: TEST_PASSWORD_HASH,
        domain: domainB,
        privateKey: 'priv-bob-iso',
        publicKey: 'pub-bob-iso'
      })
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

import {
  LookupRateLimitedError,
  createCircuitBreaker,
  createLimiter,
  createWindowCounter,
  parseRetryAfterMs
} from './rateLimit'

describe('createLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spaces call starts by the minimum interval', async () => {
    const limit = createLimiter({ maxConcurrent: 1, minIntervalMs: 1100 })
    const starts: number[] = []
    const run = () =>
      limit(async () => {
        starts.push(Date.now())
      })

    const calls = [run(), run(), run()]
    await vi.advanceTimersByTimeAsync(3000)
    await Promise.all(calls)

    const t0 = starts[0]
    expect(starts.map((start) => start - t0)).toEqual([0, 1100, 2200])
  })

  it('runs no more than maxConcurrent calls at once', async () => {
    const limit = createLimiter({ maxConcurrent: 2, minIntervalMs: 0 })
    let active = 0
    let peak = 0
    const releases: (() => void)[] = []
    const run = () =>
      limit(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => releases.push(resolve))
        active--
      })

    const calls = [run(), run(), run(), run()]
    await vi.advanceTimersByTimeAsync(0)
    expect(active).toBe(2)

    releases.splice(0).forEach((release) => release())
    await vi.advanceTimersByTimeAsync(0)
    expect(active).toBe(2)
    releases.splice(0).forEach((release) => release())
    await Promise.all(calls)

    expect(peak).toBe(2)
  })

  it('rejects a caller that would wait longer than maxWaitMs', async () => {
    const limit = createLimiter({
      maxConcurrent: 1,
      minIntervalMs: 1100,
      maxWaitMs: 2000
    })
    const accepted = [limit(async () => 1), limit(async () => 2)]
    // The third would start 2.2 s from now.
    const third = limit(async () => 3)
    const rejected = expect(third).rejects.toBeInstanceOf(
      LookupRateLimitedError
    )

    await vi.advanceTimersByTimeAsync(2000)
    await rejected
    await expect(Promise.all(accepted)).resolves.toEqual([1, 2])
  })

  // The race the limiter used to lose: slots were booked on arrival, so calls
  // that slept past their slot behind a slow call all started back to back
  // once it finished. As configured for Nominatim.
  it('keeps the interval between real starts behind a slow call', async () => {
    const limit = createLimiter({
      maxConcurrent: 1,
      minIntervalMs: 1100,
      maxWaitMs: 10_000
    })
    const t0 = Date.now()
    const starts: number[] = []
    const run = (durationMs: number) =>
      limit(async () => {
        starts.push(Date.now() - t0)
        if (durationMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, durationMs))
        }
      })

    const calls = [run(4000), run(0), run(0), run(0)]
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all(calls)

    expect(starts).toEqual([0, 4000, 5100, 6200])
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1100)
    }
  })

  it('counts the time queued for a slot inside maxWaitMs', async () => {
    const limit = createLimiter({
      maxConcurrent: 1,
      minIntervalMs: 1100,
      maxWaitMs: 10_000
    })
    const slow = limit(
      () => new Promise((resolve) => setTimeout(() => resolve('slow'), 12_000))
    )
    const ran = vi.fn()
    const queued = limit(async () => ran())
    const rejected = expect(queued).rejects.toBeInstanceOf(
      LookupRateLimitedError
    )

    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    await vi.advanceTimersByTimeAsync(2000)
    await expect(slow).resolves.toBe('slow')
    expect(ran).not.toHaveBeenCalled()
  })

  it('lets beforeStart stop a call that waited for its turn', async () => {
    const limit = createLimiter({ maxConcurrent: 1, minIntervalMs: 1100 })
    let open = false
    const beforeStart = () => {
      if (open) throw new Error('circuit open')
    }
    const fetched = vi.fn()
    const first = limit(
      async () => {
        fetched('first')
        // The first call fails and opens the circuit.
        open = true
      },
      { beforeStart }
    )
    const second = limit(async () => fetched('second'), { beforeStart })
    const secondRejected = expect(second).rejects.toThrow('circuit open')

    await vi.advanceTimersByTimeAsync(2000)
    await first
    await secondRejected
    expect(fetched.mock.calls).toEqual([['first']])
  })

  it('frees the slot when a call throws', async () => {
    const limit = createLimiter({ maxConcurrent: 1, minIntervalMs: 0 })
    await expect(
      limit(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    await expect(limit(async () => 'ok')).resolves.toBe('ok')
  })
})

describe('createWindowCounter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to the limit per key per window, then resets', () => {
    const counter = createWindowCounter({ limit: 2, windowMs: 60_000 })

    expect(counter.tryHit('a')).toBe(true)
    expect(counter.tryHit('a')).toBe(true)
    expect(counter.tryHit('a')).toBe(false)
    expect(counter.tryHit('b')).toBe(true)

    vi.advanceTimersByTime(60_001)
    expect(counter.tryHit('a')).toBe(true)
  })

  it('stays bounded by dropping the oldest key', () => {
    const counter = createWindowCounter({
      limit: 1,
      windowMs: 60_000,
      maxKeys: 2
    })
    counter.tryHit('a')
    counter.tryHit('b')
    counter.tryHit('c')

    // "a" was evicted, so it counts as new again; "c" is still limited.
    expect(counter.tryHit('a')).toBe(true)
    expect(counter.tryHit('c')).toBe(false)
  })
})

describe('createCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens for five minutes by default', () => {
    const breaker = createCircuitBreaker()
    expect(breaker.isOpen()).toBe(false)

    breaker.open()
    expect(breaker.isOpen()).toBe(true)
    vi.advanceTimersByTime(5 * 60 * 1000 - 1)
    expect(breaker.isOpen()).toBe(true)
    vi.advanceTimersByTime(2)
    expect(breaker.isOpen()).toBe(false)
  })

  it('honours a Retry-After, up to its cap', () => {
    const breaker = createCircuitBreaker({ maxOpenMs: 10 * 60 * 1000 })

    breaker.open(30_000)
    vi.advanceTimersByTime(31_000)
    expect(breaker.isOpen()).toBe(false)

    breaker.open(24 * 60 * 60 * 1000)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    expect(breaker.isOpen()).toBe(false)
  })

  it('reports how long it stays open', () => {
    const breaker = createCircuitBreaker()
    expect(breaker.remainingMs()).toBe(0)
    breaker.open(30_000)
    vi.advanceTimersByTime(10_000)
    expect(breaker.remainingMs()).toBe(20_000)
  })

  it('closes on request', () => {
    const breaker = createCircuitBreaker()
    breaker.open()
    breaker.close()
    expect(breaker.isOpen()).toBe(false)
  })
})

describe('parseRetryAfterMs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['120', 120_000],
    ['Thu, 08 Oct 2026 00:01:00 GMT', 60_000],
    ['0', undefined],
    ['soon', undefined],
    [undefined, undefined]
  ])('parses %s', (value, expected) => {
    expect(parseRetryAfterMs(value)).toBe(expected)
  })
})

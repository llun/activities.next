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
    await expect(limit(async () => 3)).rejects.toBeInstanceOf(
      LookupRateLimitedError
    )

    await vi.advanceTimersByTimeAsync(2000)
    await expect(Promise.all(accepted)).resolves.toEqual([1, 2])
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

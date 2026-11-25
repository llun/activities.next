import {
  PDS_FIREHOSE_MAX_CONNECTIONS_PER_CLIENT,
  PDS_FIREHOSE_MAX_CONNECTIONS_PER_PROCESS,
  createPdsFirehoseConnectionLimiter
} from './limits'

describe('PDS firehose connection limits', () => {
  it('enforces the default per-client limit (5) and releases slots idempotently', () => {
    const limiter = createPdsFirehoseConnectionLimiter()
    const releases: Array<() => void> = []

    for (let i = 0; i < PDS_FIREHOSE_MAX_CONNECTIONS_PER_CLIENT; i += 1) {
      const release = limiter.tryAcquire('203.0.113.10')
      expect(release).not.toBeNull()
      releases.push(release!)
    }

    expect(limiter.getActiveCount()).toBe(5)
    expect(limiter.getClientActiveCount('203.0.113.10')).toBe(5)
    expect(limiter.tryAcquire('203.0.113.10')).toBeNull()

    // Another client can still connect.
    const otherRelease = limiter.tryAcquire('203.0.113.11')
    expect(otherRelease).not.toBeNull()
    expect(limiter.getActiveCount()).toBe(6)

    // Calling release multiple times decrements only once.
    releases[0]()
    releases[0]()
    expect(limiter.getClientActiveCount('203.0.113.10')).toBe(4)
    expect(limiter.getActiveCount()).toBe(5)

    // Freed slot can be acquired again.
    const reacquired = limiter.tryAcquire('203.0.113.10')
    expect(reacquired).not.toBeNull()
    expect(limiter.getClientActiveCount('203.0.113.10')).toBe(5)

    // Clean up all slots.
    for (const release of releases.slice(1)) release()
    reacquired!()
    otherRelease!()
    expect(limiter.getActiveCount()).toBe(0)
    expect(limiter.getClientActiveCount('203.0.113.10')).toBe(0)
  })

  it('enforces the process-wide limit (100) and counts null clientKey only against process limit', () => {
    const limiter = createPdsFirehoseConnectionLimiter()
    const releases: Array<() => void> = []

    for (let i = 0; i < PDS_FIREHOSE_MAX_CONNECTIONS_PER_PROCESS; i += 1) {
      const release = limiter.tryAcquire(null)
      expect(release).not.toBeNull()
      releases.push(release!)
    }

    expect(limiter.getActiveCount()).toBe(100)
    expect(limiter.tryAcquire(null)).toBeNull()
    expect(limiter.tryAcquire('203.0.113.50')).toBeNull()

    releases[0]()
    const keyed = limiter.tryAcquire('203.0.113.50')
    expect(keyed).not.toBeNull()
    expect(limiter.getActiveCount()).toBe(100)
    expect(limiter.getClientActiveCount('203.0.113.50')).toBe(1)
  })
})

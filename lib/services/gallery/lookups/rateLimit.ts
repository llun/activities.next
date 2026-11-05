// Small in-process helpers shared by the gallery lookups (GBIF, Nominatim) and
// by anything else that needs a bounded per-key counter.
//
// They are best effort and per process: a deployment with several instances
// gets several limiters. The lookup cache (lookupCache.ts) is the protection
// that is shared between them.

export class LookupRateLimitedError extends Error {
  constructor(message = 'Lookup rate limited') {
    super(message)
    this.name = 'LookupRateLimitedError'
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface LimiterOptions {
  // How many calls may run at once.
  maxConcurrent: number
  // The least time between the START of two calls, measured from when each
  // call actually started (not from when it arrived).
  minIntervalMs: number
  // A call that would have to wait longer than this in all, for a free slot
  // and then for its interval, is rejected with LookupRateLimitedError.
  // Undefined waits for ever.
  maxWaitMs?: number
  // Rejects when this many calls are already waiting for a free slot.
  maxQueue?: number
}

export interface LimiterRunOptions {
  // Runs once the call holds its slot and its interval has passed, right
  // before `fn`. Throwing aborts the call without starting it: a provider
  // whose circuit opened while this call waited is not asked anyway.
  beforeStart?: () => void
}

export type Limiter = <T>(
  fn: () => Promise<T>,
  options?: LimiterRunOptions
) => Promise<T>

export const createLimiter = ({
  maxConcurrent,
  minIntervalMs,
  maxWaitMs,
  maxQueue = 100
}: LimiterOptions): Limiter => {
  let active = 0
  // The earliest time the next call may start. Booked by a call once it holds
  // a slot (so concurrent holders never start together), then moved on again
  // from the moment it really started.
  let nextStart = 0
  const waiters: (() => void)[] = []

  const acquire = (deadline: number): Promise<void> => {
    if (active < maxConcurrent) {
      active += 1
      return Promise.resolve()
    }
    if (waiters.length >= maxQueue) {
      return Promise.reject(new LookupRateLimitedError())
    }
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const grant = () => {
        if (timer !== undefined) clearTimeout(timer)
        active += 1
        resolve()
      }
      if (Number.isFinite(deadline)) {
        timer = setTimeout(
          () => {
            const index = waiters.indexOf(grant)
            if (index >= 0) waiters.splice(index, 1)
            reject(new LookupRateLimitedError())
          },
          Math.max(0, deadline - Date.now())
        )
      }
      waiters.push(grant)
    })
  }

  const release = () => {
    active -= 1
    waiters.shift()?.()
  }

  return async (fn, { beforeStart } = {}) => {
    // The cap covers the whole wait: the time queued for a slot counts.
    const deadline =
      maxWaitMs === undefined
        ? Number.POSITIVE_INFINITY
        : Date.now() + maxWaitMs
    await acquire(deadline)
    try {
      const now = Date.now()
      const startAt = Math.max(now, nextStart)
      // Only a call that has to WAIT past the cap is rejected. One that can
      // start right now waited for nothing: the clock moving on between
      // reading the deadline and getting here (a slow event loop, a 1 ms tick
      // with maxWaitMs 0) must not turn it away, or it would also leave the
      // interval unbooked and let the next call through.
      if (startAt > now && startAt > deadline) {
        throw new LookupRateLimitedError()
      }
      nextStart = startAt + minIntervalMs
      if (startAt > now) await sleep(startAt - now)

      beforeStart?.()
      // Measured from the real start: a timer that fired late must not let
      // the next call in early.
      nextStart = Math.max(nextStart, Date.now() + minIntervalMs)
      return await fn()
    } finally {
      release()
    }
  }
}

export interface WindowCounterOptions {
  limit: number
  windowMs: number
  // The map is bounded. Expired keys are dropped first; when every held key is
  // still live, the oldest is evicted, so a flood of fresh keys cannot refuse
  // everyone else.
  maxKeys?: number
  // For a security limit, where evicting a live key would reset a victim's
  // allowance (random sign-in emails pushing a target's counter out): a key
  // whose count has reached this is never evicted. The oldest key below it is
  // evicted instead, so a flood of one-off keys only pushes out its own kind;
  // when every held key is protected a NEW key is refused until a window
  // expires. Unset, any key may be evicted.
  protectCountsFrom?: number
  // With protectCountsFrom: whether a full map of protected keys refuses new
  // keys (true, the default) or evicts the oldest one anyway (false). Read on
  // each overflow, so it can follow runtime config.
  refuseWhenAllProtected?: boolean | (() => boolean)
}

export type WindowCounterResult =
  { allowed: true } | { allowed: false; retryAfterSeconds: number }

export interface WindowCounter {
  // Counts one hit for the key. False when the key is over its limit for the
  // current window (the hit is not counted then).
  tryHit(key: string): boolean
  // Same as tryHit, returning the remaining window seconds when rejected so
  // HTTP routes can populate Retry-After.
  consume(key: string): WindowCounterResult
  reset(): void
}

// A fixed-window counter per key, on a bounded Map.
export const createWindowCounter = ({
  limit,
  windowMs,
  maxKeys = 1000,
  protectCountsFrom = Number.POSITIVE_INFINITY,
  refuseWhenAllProtected = true
}: WindowCounterOptions): WindowCounter => {
  const windows = new Map<string, { count: number; resetAt: number }>()

  const retryAfterSeconds = (resetAt: number, now: number) =>
    Math.max(1, Math.ceil((resetAt - now) / 1000))

  const consume = (key: string): WindowCounterResult => {
    const now = Date.now()
    const current = windows.get(key)
    if (current && current.resetAt > now) {
      if (current.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: retryAfterSeconds(current.resetAt, now)
        }
      }
      current.count += 1
      return { allowed: true }
    }
    // A new key, or one whose window has passed.
    if (current) windows.delete(key)
    if (windows.size >= maxKeys) {
      for (const [other, window] of windows) {
        if (window.resetAt <= now) windows.delete(other)
      }
      if (windows.size >= maxKeys) {
        // Insertion order is age order, so the first unprotected key is the
        // oldest one that may go.
        for (const [other, window] of windows) {
          if (window.count < protectCountsFrom) {
            windows.delete(other)
            break
          }
        }
      }
      const refuse =
        typeof refuseWhenAllProtected === 'function'
          ? refuseWhenAllProtected()
          : refuseWhenAllProtected
      if (windows.size >= maxKeys && !refuse) {
        const oldest = windows.keys().next().value
        if (oldest !== undefined) windows.delete(oldest)
      }
      if (windows.size >= maxKeys) {
        let soonest = Number.POSITIVE_INFINITY
        for (const window of windows.values()) {
          soonest = Math.min(soonest, window.resetAt)
        }
        return {
          allowed: false,
          retryAfterSeconds: retryAfterSeconds(soonest, now)
        }
      }
    }
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }

  return {
    tryHit(key) {
      return consume(key).allowed
    },
    consume,
    reset() {
      windows.clear()
    }
  }
}

export interface CircuitBreakerOptions {
  // How long a provider counts as down when it gave no Retry-After.
  defaultOpenMs?: number
  // An upper bound on a provider-supplied Retry-After.
  maxOpenMs?: number
}

export interface CircuitBreaker {
  isOpen(): boolean
  // How long the provider still counts as down, in milliseconds (0 = closed).
  remainingMs(): number
  // Marks the provider as down for `retryAfterMs`, or the default.
  open(retryAfterMs?: number): void
  close(): void
}

export const DEFAULT_CIRCUIT_OPEN_MS = 5 * 60 * 1000

// After a timeout, a 5xx or a 429 a provider is "down" for a while and calls
// fail fast, so an air-gapped server does not add a timeout to every upload.
export const createCircuitBreaker = ({
  defaultOpenMs = DEFAULT_CIRCUIT_OPEN_MS,
  maxOpenMs = 60 * 60 * 1000
}: CircuitBreakerOptions = {}): CircuitBreaker => {
  let openUntil = 0

  return {
    isOpen: () => Date.now() < openUntil,
    remainingMs: () => Math.max(0, openUntil - Date.now()),
    open(retryAfterMs) {
      const duration =
        retryAfterMs !== undefined && retryAfterMs > 0
          ? Math.min(retryAfterMs, maxOpenMs)
          : defaultOpenMs
      openUntil = Math.max(openUntil, Date.now() + duration)
    },
    close() {
      openUntil = 0
    }
  }
}

// `Retry-After` is either a number of seconds or an HTTP date.
export const parseRetryAfterMs = (
  value: string | string[] | undefined
): number | undefined => {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? seconds * 1000 : undefined
  }
  const date = Date.parse(raw)
  if (Number.isNaN(date)) return undefined
  const delta = date - Date.now()
  return delta > 0 ? delta : undefined
}

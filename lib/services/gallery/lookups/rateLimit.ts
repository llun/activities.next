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
      if (startAt > deadline) throw new LookupRateLimitedError()
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
  // The map is bounded: past this many keys the oldest window is dropped.
  maxKeys?: number
}

export interface WindowCounter {
  // Counts one hit for the key. False when the key is over its limit for the
  // current window (the hit is not counted then).
  tryHit(key: string): boolean
  reset(): void
}

// A fixed-window counter per key, on a bounded Map.
export const createWindowCounter = ({
  limit,
  windowMs,
  maxKeys = 1000
}: WindowCounterOptions): WindowCounter => {
  const windows = new Map<string, { count: number; resetAt: number }>()

  return {
    tryHit(key) {
      const now = Date.now()
      const current = windows.get(key)
      if (!current || current.resetAt <= now) {
        // Re-insert so Map order stays oldest-first.
        windows.delete(key)
        windows.set(key, { count: 1, resetAt: now + windowMs })
        if (windows.size > maxKeys) {
          const oldest = windows.keys().next().value
          if (oldest !== undefined) windows.delete(oldest)
        }
        return true
      }
      if (current.count >= limit) return false
      current.count += 1
      return true
    },
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

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
  // The least time between the START of two calls.
  minIntervalMs: number
  // A call that would have to wait longer than this to start is rejected with
  // LookupRateLimitedError instead of waiting. Undefined waits for ever.
  maxWaitMs?: number
  // Rejects when this many calls are already waiting for a free slot.
  maxQueue?: number
}

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>

export const createLimiter = ({
  maxConcurrent,
  minIntervalMs,
  maxWaitMs,
  maxQueue = 100
}: LimiterOptions): Limiter => {
  let active = 0
  let nextStart = 0
  const queue: (() => void)[] = []

  const acquire = (): Promise<void> => {
    if (active < maxConcurrent) {
      active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        active += 1
        resolve()
      })
    })
  }

  const release = () => {
    active -= 1
    queue.shift()?.()
  }

  return async (fn) => {
    const now = Date.now()
    const startAt = Math.max(now, nextStart)
    if (
      (maxWaitMs !== undefined && startAt - now > maxWaitMs) ||
      queue.length >= maxQueue
    ) {
      throw new LookupRateLimitedError()
    }
    nextStart = startAt + minIntervalMs
    if (startAt > now) await sleep(startAt - now)

    await acquire()
    try {
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

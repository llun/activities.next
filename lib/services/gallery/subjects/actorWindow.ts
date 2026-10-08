// A fixed-window counter per key (the actor), in process memory. Best effort
// by design: on a multi-instance deployment each process counts on its own,
// which is enough to stop one account from running up the vision bill or
// hammering GBIF.

export interface ActorWindow {
  /** Records one use for `key`; false when the window's limit is spent. */
  take: (key: string, now?: number) => boolean
}

// A bounded Map: once full, windows that have ended are dropped first, then
// the oldest entry, so a flood of distinct keys cannot grow it without limit.
const MAX_KEYS = 5000

export const createActorWindow = ({
  limit,
  windowMs
}: {
  limit: number
  windowMs: number
}): ActorWindow => {
  const windows = new Map<string, { startedAt: number; count: number }>()

  const evict = (now: number) => {
    for (const [key, entry] of windows) {
      if (now - entry.startedAt >= windowMs) windows.delete(key)
    }
    while (windows.size >= MAX_KEYS) {
      const oldest = windows.keys().next()
      if (oldest.done) return
      windows.delete(oldest.value)
    }
  }

  return {
    take(key, now = Date.now()) {
      const current = windows.get(key)
      if (current && now - current.startedAt < windowMs) {
        if (current.count >= limit) return false
        current.count += 1
        return true
      }
      if (!current) evict(now)
      windows.set(key, { startedAt: now, count: 1 })
      return true
    }
  }
}

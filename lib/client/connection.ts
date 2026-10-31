// The connection store: no React, one module-level store. Browser events are
// only hints; a probe of `GET /health` decides the state. A failed request
// (`reportRequestFailure`) only triggers a probe too, so a 503 the server
// answered (a create it kept) leaves the state `online`.
import { checkServerHealth } from '@/lib/client/health'

export type ConnectionState = 'online' | 'offline' | 'unreachable'

export interface ConnectionSnapshot {
  state: ConnectionState
  /** When the next automatic probe runs; null while online or the tab is hidden. */
  nextProbeAt: number | null
  /** A probe is in flight while the state is not online (Retry shows it). */
  probing: boolean
}

export const PROBE_TIMEOUT_MS = 8_000
/** Delay before each automatic probe while down; the last value repeats. */
export const PROBE_BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const

/** Also the server snapshot, so hydration matches. */
export const ONLINE_CONNECTION_SNAPSHOT: ConnectionSnapshot = {
  state: 'online',
  nextProbeAt: null,
  probing: false
}

let snapshot = ONLINE_CONNECTION_SNAPSHOT
let generation = 0
let inflight: Promise<void> | null = null
let backoffIndex = 0
let timer: ReturnType<typeof setTimeout> | null = null
let cancelProbe: (() => void) | null = null
let windowListenersInstalled = false
const listeners = new Set<() => void>()
const restoredListeners = new Set<() => void>()

export const getConnectionSnapshot = (): ConnectionSnapshot => snapshot

const setSnapshot = (next: ConnectionSnapshot) => {
  if (
    next.state === snapshot.state &&
    next.nextProbeAt === snapshot.nextProbeAt &&
    next.probing === snapshot.probing
  ) {
    return
  }
  snapshot = next
  for (const listener of [...listeners]) listener()
}

const clearTimer = () => {
  if (timer) clearTimeout(timer)
  timer = null
}

const isVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible'

// Scheduled only while the tab is visible; `visibilitychange` probes at once
// when it comes back.
const scheduleProbe = (): number | null => {
  clearTimer()
  if (!isVisible()) return null
  const delay =
    PROBE_BACKOFF_MS[Math.min(backoffIndex, PROBE_BACKOFF_MS.length - 1)]
  backoffIndex += 1
  timer = setTimeout(() => void probeNow(), delay)
  return Date.now() + delay
}

export const probeNow = (): Promise<void> => {
  if (inflight) return inflight
  const startedIn = generation
  clearTimer()
  if (snapshot.state !== 'online') setSnapshot({ ...snapshot, probing: true })

  const run = (async () => {
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const cancel = () => {
      clearTimeout(abortTimer)
      controller.abort()
    }
    cancelProbe = cancel
    let healthy = false
    try {
      healthy = await checkServerHealth({ signal: controller.signal })
    } catch {
      healthy = false
    } finally {
      clearTimeout(abortTimer)
      if (cancelProbe === cancel) cancelProbe = null
    }
    if (startedIn !== generation) return

    if (healthy) {
      const wasOnline = snapshot.state === 'online'
      backoffIndex = 0
      setSnapshot(ONLINE_CONNECTION_SNAPSHOT)
      if (!wasOnline) for (const listener of [...restoredListeners]) listener()
      return
    }
    const state: ConnectionState =
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'offline'
        : 'unreachable'
    setSnapshot({ state, nextProbeAt: scheduleProbe(), probing: false })
  })()

  const tracked = run.finally(() => {
    if (inflight === tracked) inflight = null
  })
  inflight = tracked
  return tracked
}

const shouldProbeFor = (error: unknown): boolean => {
  if (error instanceof TypeError) return true
  if (typeof error !== 'object' || error === null) return false
  const { name, status } = error as { name?: unknown; status?: unknown }
  if (name === 'AbortError' || name === 'TimeoutError') return true
  return status === 502 || status === 503 || status === 504
}

/** Call from a request's non-401 catch; only network-shaped failures probe. */
export const reportRequestFailure = (error: unknown): void => {
  if (shouldProbeFor(error)) void probeNow()
}

const handleBrowserEvent = () => void probeNow()

const handleVisibilityChange = () => {
  if (snapshot.state === 'online') return
  if (isVisible()) {
    void probeNow()
    return
  }
  clearTimer()
  setSnapshot({ ...snapshot, nextProbeAt: null })
}

const installWindowListeners = () => {
  if (windowListenersInstalled || typeof window === 'undefined') return
  windowListenersInstalled = true
  window.addEventListener('online', handleBrowserEvent)
  window.addEventListener('offline', handleBrowserEvent)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  // No probe at subscribe unless the browser already says it is offline.
  if (navigator.onLine === false) void probeNow()
}

const removeWindowListeners = () => {
  if (!windowListenersInstalled) return
  windowListenersInstalled = false
  window.removeEventListener('online', handleBrowserEvent)
  window.removeEventListener('offline', handleBrowserEvent)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
}

const hasObservers = () => listeners.size > 0 || restoredListeners.size > 0

// Nothing is left to tell, so no timer or request outlives the last observer.
const stopProbing = () => {
  generation += 1
  clearTimer()
  cancelProbe?.()
  cancelProbe = null
  inflight = null
}

const stopProbingIfUnobserved = () => {
  if (hasObservers()) return
  stopProbing()
  setSnapshot({ ...snapshot, nextProbeAt: null, probing: false })
}

const resumeProbing = () => {
  if (snapshot.state !== 'online' && isVisible() && !inflight && !timer) {
    void probeNow()
  }
}

export const subscribeConnection = (listener: () => void): (() => void) => {
  listeners.add(listener)
  installWindowListeners()
  // Probing stops with the last subscriber while hidden; resume it here.
  resumeProbing()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) removeWindowListeners()
    stopProbingIfUnobserved()
  }
}

export const onConnectionRestored = (listener: () => void): (() => void) => {
  restoredListeners.add(listener)
  resumeProbing()
  return () => {
    restoredListeners.delete(listener)
    stopProbingIfUnobserved()
  }
}

export const resetConnectionForTesting = (): void => {
  stopProbing()
  removeWindowListeners()
  listeners.clear()
  restoredListeners.clear()
  backoffIndex = 0
  snapshot = ONLINE_CONNECTION_SNAPSHOT
}

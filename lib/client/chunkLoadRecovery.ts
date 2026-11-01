import { reportClientError } from '@/lib/client/clientErrors'

export const CHUNK_RELOAD_KEY = 'activities_chunk_reload_at'
const FIVE_MINUTES_MS = 5 * 60 * 1000
const CHUNK_ERROR_PATTERN =
  /Loading (CSS )?chunk .* failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i

/**
 * Recognizes chunk load failures by error name or message patterns across
 * browsers and bundlers.
 */
export const isChunkLoadError = (error: unknown): boolean => {
  if (!error) return false
  if (typeof error === 'string') {
    return CHUNK_ERROR_PATTERN.test(error)
  }
  if (typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown }
    if (candidate.name === 'ChunkLoadError') return true
    if (typeof candidate.message === 'string') {
      return CHUNK_ERROR_PATTERN.test(candidate.message)
    }
  }
  return false
}

/**
 * Reloads the window at most once after a chunk load error. Guarded by a 5-minute
 * sessionStorage timestamp to prevent infinite reload loops. Attempts to update
 * the service worker registration before reloading with a 1000ms timeout race.
 */
export const reloadOnceAfterChunkError = async (): Promise<void> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return
    }

    const now = Date.now()
    try {
      const stored = sessionStorage.getItem(CHUNK_RELOAD_KEY)
      if (stored) {
        const timestamp = Number(stored)
        if (Number.isFinite(timestamp) && now - timestamp < FIVE_MINUTES_MS) {
          return
        }
      }
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
    } catch {
      // When storage throws, do not reload because the loop guard is gone
      return
    }

    try {
      const updatePromise = navigator.serviceWorker
        ?.getRegistration()
        .then((registration) => registration?.update())
        .catch(() => {})
      if (updatePromise) {
        const timeoutPromise = new Promise((resolve) =>
          setTimeout(resolve, 1000)
        )
        await Promise.race([updatePromise, timeoutPromise]).catch(() => {})
      }
    } catch {
      // Swallowed: hung or failed service worker update must never block reload
    }

    if (
      typeof window !== 'undefined' &&
      typeof window.location?.reload === 'function'
    ) {
      window.location.reload()
    }
  } catch {
    // Never throws
  }
}

/**
 * Handles errors caught by React error boundaries: reports to the server, and
 * triggers a guarded reload on chunk load errors.
 */
export const handleBoundaryError = (
  error: unknown,
  source: 'global-error' | 'error'
): void => {
  try {
    if (isChunkLoadError(error)) {
      reportClientError(error, 'chunk-load')
      void reloadOnceAfterChunkError()
    } else {
      reportClientError(error, source)
    }
  } catch {
    // Never throws
  }
}

import { useSyncExternalStore } from 'react'

/**
 * The instant scrubbed on the activity charts, in elapsed seconds, or null.
 *
 * It changes on every pointer move over a chart, so it is held outside React
 * state: only the chart and the map subscribe to it, and a hover re-renders
 * those two rather than the whole page (the post, its media and replies, and
 * every section between them).
 */
export interface ScrubStore {
  get: () => number | null
  set: (elapsedSeconds: number | null) => void
  subscribe: (listener: () => void) => () => void
}

export const createScrubStore = (): ScrubStore => {
  let current: number | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (elapsedSeconds) => {
      if (elapsedSeconds === current) return
      current = elapsedSeconds
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

const getServerSnapshot = () => null

/** The scrubbed instant, re-rendering the caller only when it changes. */
export const useScrubPosition = (store: ScrubStore): number | null =>
  useSyncExternalStore(store.subscribe, store.get, getServerSnapshot)

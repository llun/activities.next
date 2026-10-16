'use client'

import { ComponentType, createElement } from 'react'

/**
 * Keeps a `next/dynamic` code split but lets it render synchronously once its
 * chunk has been preloaded. A `next/dynamic` component is a `React.lazy`, which
 * always suspends the first time a given lazy instance renders (its status only
 * flips in an async `.then`), even when the module is already loaded. React then
 * holds the Suspense reveal for up to 300ms after the fallback commits, so the
 * first open of a preloaded dialog or tab still costs ~300ms.
 *
 * `preload()` remembers the resolved component; after that `Component` renders
 * it directly with no suspension. Until then (including the server render and
 * hydration, so SSR output is unchanged) it renders `dynamicComponent`.
 *
 * Pass the result of a module-scope `dynamic(load, {...})` call; `dynamic`
 * must keep its inline options object literal where Next's compiler sees it.
 * Never call `preload()` at module top level: start it from an event handler or
 * an effect so it cannot change what hydration renders.
 */
export function createPreloadable<P extends object>(
  load: () => Promise<ComponentType<P>>,
  dynamicComponent: ComponentType<P>
) {
  let Loaded: ComponentType<P> | null = null

  const preload = (): Promise<void> =>
    load()
      .then((component) => {
        Loaded = component
      })
      .catch(() => undefined)

  const Preloadable = (props: P) =>
    createElement(Loaded ?? dynamicComponent, props)

  return { Component: Preloadable as ComponentType<P>, preload }
}

/** Runs `callback` at idle (or after 1s where `requestIdleCallback` is missing); returns a cancel function. */
export function runWhenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback !== 'function') {
    const timer = window.setTimeout(callback, 1000)
    return () => window.clearTimeout(timer)
  }
  const handle = window.requestIdleCallback(callback)
  return () => window.cancelIdleCallback(handle)
}

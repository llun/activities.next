// An approximate record of the pathnames this tab has visited through the app,
// so a history-based Back (the status page's "Back") can tell whether
// `router.back()` would return somewhere inside the app or leave it — a
// permalink opened from another site, a bookmark or a fresh tab has nothing in
// the app to go back to, and must offer a real link instead.
//
// The browser does not expose its history entries, so this is a heuristic over
// the pathnames the `InAppHistoryTracker` observes: a pathname equal to the
// entry before the current one is read as a Back and pops, anything else
// pushes. A browser Forward after a Back can therefore be miscounted; the only
// consequence is that the page shows its fallback link, never that Back leaves
// the app. The stack lives in module memory, so a full reload starts over —
// again erring towards the fallback.
//
// Dependency-free so it can be unit-tested without React.

const MAX_ENTRIES = 50

type Listener = () => void

let stack: readonly string[] = []
const listeners = new Set<Listener>()

const notify = () => {
  for (const listener of listeners) listener()
}

export const recordNavigation = (pathname: string) => {
  const last = stack[stack.length - 1]
  if (last === pathname) return

  if (stack.length >= 2 && stack[stack.length - 2] === pathname) {
    stack = stack.slice(0, -1)
  } else {
    stack = [...stack, pathname].slice(-MAX_ENTRIES)
  }
  notify()
}

/**
 * Whether an in-app page precedes `currentPathname`.
 *
 * It holds both before and after the tracker records the current pathname, so
 * the first render of a page — which happens before the tracker's effect — and
 * every render after it agree: before the effect the last entry is the page we
 * came from; after it, the page we came from is the entry below the current one.
 */
export const hasInAppPrevious = (currentPathname: string) => {
  const last = stack[stack.length - 1]
  if (last === undefined) return false
  if (last !== currentPathname) return true
  return stack.length >= 2
}

export const subscribeToInAppHistory = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only: forget every recorded entry. */
export const resetInAppHistory = () => {
  stack = []
  notify()
}

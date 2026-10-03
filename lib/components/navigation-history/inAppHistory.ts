// An approximate record of the pathnames this tab has visited through the app,
// so a history-based Back (the status page's "Back") can tell whether
// `router.back()` would return somewhere inside the app or leave it — a
// permalink opened from another site, a bookmark or a fresh tab has nothing in
// the app to go back to, and must offer a real link instead.
//
// The browser does not expose its history entries, so this is a heuristic over
// the pathnames the `InAppHistoryTracker` observes. A pathname already on the
// stack is read as a return to it — by Back, a multi-step `history.go(-n)`, or
// a link — and truncates the stack to its first occurrence; anything else
// pushes. Truncating to the *first* occurrence is what keeps the entry page
// safe: arriving at P0, visiting X and Y, then jumping back to P0 leaves just
// [P0], so its Back is the fallback link rather than a `router.back()` out of
// the app. The stack therefore never holds a pathname twice.
//
// It still errs in both directions. Following a link back to a page visited
// earlier, or a browser Forward after a Back, drops entries the browser still
// has, so the page shows its fallback link where a Back would have worked. And
// a `router.replace` on the entry page records a second, different pathname, so
// that page then offers a Back that leaves the app. The stack lives in module
// memory, so a full reload starts over — erring towards the fallback.
//
// Dependency-free so it can be unit-tested without React.

export const MAX_ENTRIES = 50

type Listener = () => void

let stack: readonly string[] = []
const listeners = new Set<Listener>()

const notify = () => {
  for (const listener of listeners) listener()
}

export const recordNavigation = (pathname: string) => {
  if (stack[stack.length - 1] === pathname) return

  const index = stack.indexOf(pathname)
  stack =
    index >= 0
      ? stack.slice(0, index + 1)
      : [...stack, pathname].slice(-MAX_ENTRIES)
  notify()
}

/**
 * Whether an in-app page precedes `currentPathname`.
 *
 * It answers for the stack as it is once the tracker has recorded
 * `currentPathname`, so the first render of a page — which happens before the
 * tracker's effect — and every render after it agree: a pathname already on the
 * stack will be truncated to, so something precedes it only if it is not the
 * bottom entry; a new one will be pushed on top of whatever is there.
 */
export const hasInAppPrevious = (currentPathname: string) => {
  const index = stack.indexOf(currentPathname)
  return index >= 0 ? index >= 1 : stack.length >= 1
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

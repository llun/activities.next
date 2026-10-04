// An approximate record of the pathnames this tab has visited through the app,
// so a history-based Back (the status page's "Back") can tell whether
// `router.back()` would return somewhere inside the app or leave it — a
// permalink opened from another site, a bookmark or a fresh tab has nothing in
// the app to go back to, and must offer a real link instead — and, when it
// stays in the app, name the page it returns to (`backDestination`).
//
// The browser does not expose its history entries, so this is a heuristic over
// what the `InAppHistoryTracker` observes, and it models the one thing a
// pathname cannot tell apart: a push and a pop. A new pathname is a push (a
// link, `router.push`), and `router.back()` from the page it lands on returns
// to the page just left — even when that pathname is already on the stack, as
// in [Notifications, A, Profile] followed by a link back to A. A `popstate`
// (browser Back or Forward, `history.go`) is a pop: it truncates the stack to
// the nearest earlier entry for the pathname it landed on, so the stack
// mirrors the browser's own entries and its top is always the current page.
//
// It still errs. `history.go(-n)` is read as the nearest earlier entry, so a
// multi-step jump over a repeated pathname leaves entries the browser no
// longer has (on the entry page that is a Back that leaves the app); a Forward
// to a pathname already below the top is read as a pop; and a `router.replace`
// records a second pathname for one entry. A pop to a pathname not on the stack
// (Forward after Back) pushes, which errs towards a Back that exists. The stack
// lives in module memory, so a full reload starts over — erring towards the
// fallback link.
//
// Dependency-free so it can be unit-tested without React.

export const MAX_ENTRIES = 50

type Listener = () => void

let stack: readonly string[] = []
const listeners = new Set<Listener>()

const notify = () => {
  for (const listener of listeners) listener()
}

/** The tab rendered `pathname`: a push, unless it is already the top. */
export const recordNavigation = (pathname: string) => {
  if (stack[stack.length - 1] === pathname) return

  stack = [...stack, pathname].slice(-MAX_ENTRIES)
  notify()
}

/**
 * The browser traversed history (`popstate`) and landed on `pathname`: drop
 * the entries above its nearest earlier occurrence. A pathname that is not on
 * the stack below the top is left for `recordNavigation` to push.
 */
export const recordPop = (pathname: string) => {
  if (stack[stack.length - 1] === pathname) return

  const index = stack.slice(0, -1).lastIndexOf(pathname)
  if (index < 0) return

  stack = stack.slice(0, index + 1)
  notify()
}

/**
 * The in-app pathname that precedes `currentPathname`, or `null` when nothing
 * in the app does (a direct entry).
 *
 * It answers for the stack as it is once the tracker has recorded
 * `currentPathname`, so the first render of a page — which happens before the
 * tracker's effect — and every render after it agree: the top of the stack is
 * the current page and the entry below it precedes it; a page not yet recorded
 * is about to be pushed on top of whatever is there. (A pop is already on the
 * stack when the page renders: the tracker records it from `popstate`, ahead
 * of the render.)
 */
export const getInAppPrevious = (currentPathname: string): string | null => {
  const top = stack.length - 1
  if (stack[top] === currentPathname) return top >= 1 ? stack[top - 1] : null
  return top >= 0 ? stack[top] : null
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

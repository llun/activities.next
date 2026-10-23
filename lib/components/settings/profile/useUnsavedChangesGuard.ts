'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UnsavedChangesGuard {
  /** The in-app link the person clicked while there were changes, if any. */
  pendingHref: string | null
  /**
   * Whether a way out is held back and the page should ask "Discard
   * changes?": a link (`pendingHref`) or the browser's Back or Forward.
   */
  pending: boolean
  /** Closes the question and stays on the page ("Keep editing"). */
  keepEditing: () => void
  /** Follows the link or history step that was held back ("Discard"). */
  discard: () => void
  /**
   * Lets the next navigation through without asking, for a page that leaves
   * on purpose after the changes were already confirmed away (Cancel). It ends
   * with the first navigation to another path, after a few seconds if none
   * started, or when a clean page becomes unsaved again, so it cannot stay off
   * while the page is still here with unsaved changes.
   */
  allowNavigation: () => void
}

// The link a click would follow in this tab, as a path on this site, or null
// for anything the guard leaves alone: a modified click, another button, a new
// tab or a download, another site (`beforeunload` asks for that one), or a
// link that stays on this page (the same path, whatever its query or hash).
const getInAppHref = (event: MouseEvent): string | null => {
  if (event.defaultPrevented || event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null
  }
  const target = event.target
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if (anchor.hasAttribute('download')) return null
  const anchorTarget = anchor.getAttribute('target')
  if (anchorTarget && anchorTarget !== '_self') return null
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  // The same path with another query (`/settings/profile?switched=1` to
  // `/settings/profile`) renders this page again and keeps its edits, so it is
  // not leaving.
  if (url.pathname === window.location.pathname) return null
  return `${url.pathname}${url.search}${url.hash}`
}

type Pending = { kind: 'link'; href: string } | { kind: 'history'; key: string }

// How long a way out that was let through on purpose (Discard, Cancel) may take
// to start. Past it the guard asks again: the move did not happen.
const ALLOW_WINDOW_MS = 5000

// The Navigation API, where the browser has it (Chromium; Firefox and Safari
// only in recent versions). Its `navigate` event fires before a Back or Forward
// changes anything, and a traversal can be cancelled there, which `popstate`
// (fired after the history entry changed and Next's router has re-rendered)
// cannot do.
interface NavigateEventLike extends Event {
  readonly navigationType: string
  readonly cancelable: boolean
  readonly destination: {
    readonly key: string
    readonly url: string
    readonly sameDocument: boolean
  }
}
interface NavigationLike extends EventTarget {
  traverseTo: (key: string) => {
    committed: Promise<unknown>
    finished: Promise<unknown>
  }
}
const getNavigation = (): NavigationLike | null => {
  const navigation = (window as unknown as { navigation?: NavigationLike })
    .navigation
  return navigation && typeof navigation.traverseTo === 'function'
    ? navigation
    : null
}

const isThisPath = (url: string) =>
  new URL(url, window.location.href).pathname === window.location.pathname

/**
 * Asks before the page is left with unsaved changes. A click on an in-app link
 * and the browser's Back and Forward are held back (the caller shows "Discard
 * changes?" while `pending`), and closing the tab, reloading or following an
 * outside link gets the browser's own prompt through `beforeunload`. Pass
 * `dirty` as false once the changes are saved: nothing is held back then.
 *
 * Back and Forward are held back by cancelling the Navigation API's `navigate`
 * event of the traversal, before the URL or Next's router change, and Discard
 * replays the step with `traverseTo`. Limits: a browser without the Navigation
 * API keeps only the `beforeunload` prompt, and Chromium only lets a page
 * cancel a traversal after the person has interacted with it since the last
 * one, so a second Back pressed before touching the page again goes through
 * and the unsaved edits are lost. Traversals to another document (an outside
 * site, a reload) are left to `beforeunload`, and traversals that stay on this
 * path (only the query or hash differs) never ask.
 */
export const useUnsavedChangesGuard = (dirty: boolean): UnsavedChangesGuard => {
  const router = useRouter()
  const [pending, setPending] = useState<Pending | null>(null)
  const allowed = useRef(false)
  const allowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Read at the moment of the click or unload, not when an effect last ran: a
  // save that just finished must stand the guard down at once, before React has
  // got round to re-subscribing.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const disarmTimer = useCallback(() => {
    if (allowTimer.current !== null) clearTimeout(allowTimer.current)
    allowTimer.current = null
  }, [])
  // Lets one move through. It ends with the first navigation to another path,
  // or when the window runs out without one, or when a clean page becomes unsaved again.
  const allowOnce = useCallback(() => {
    allowed.current = true
    disarmTimer()
    allowTimer.current = setTimeout(() => {
      allowed.current = false
      allowTimer.current = null
    }, ALLOW_WINDOW_MS)
  }, [disarmTimer])
  const rearm = useCallback(() => {
    allowed.current = false
    disarmTimer()
  }, [disarmTimer])

  useEffect(() => {
    if (dirty) rearm()
    // A way out that was held back is moot once nothing is unsaved (a save
    // finished while the question was open).
    else setPending(null)
  }, [dirty, rearm])

  useEffect(() => disarmTimer, [disarmTimer])

  useEffect(() => {
    const navigation = getNavigation()

    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current || allowed.current) return
      const href = getInAppHref(event)
      if (!href) return
      // Capture phase on the document: runs before the link's own handler, so
      // Next's client navigation never starts.
      event.preventDefault()
      event.stopPropagation()
      setPending({ kind: 'link', href })
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || allowed.current) return
      event.preventDefault()
      // Some browsers still need a return value to show the prompt.
      event.returnValue = ''
    }
    const onNavigate = (raw: Event) => {
      const event = raw as NavigateEventLike
      if (isThisPath(event.destination.url)) return
      if (allowed.current) {
        // The move that was let through is under way.
        rearm()
        return
      }
      if (!dirtyRef.current) return
      if (event.navigationType !== 'traverse') return
      // Another document is for `beforeunload`; a traversal the browser does
      // not let the page cancel cannot be held.
      if (!event.destination.sameDocument || !event.cancelable) return
      event.preventDefault()
      setPending({ kind: 'history', key: event.destination.key })
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('beforeunload', onBeforeUnload)
    navigation?.addEventListener('navigate', onNavigate)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
      navigation?.removeEventListener('navigate', onNavigate)
    }
  }, [rearm])

  const keepEditing = useCallback(() => setPending(null), [])
  const discard = useCallback(() => {
    const held = pending
    setPending(null)
    if (!held) return
    allowOnce()
    if (held.kind === 'link') {
      router.push(held.href)
      return
    }
    const traversal = getNavigation()?.traverseTo(held.key)
    // The entry is gone (the history was cleared meanwhile): stay, and ask
    // again next time.
    traversal?.committed.catch(rearm)
    traversal?.finished.catch(() => {})
  }, [pending, router, allowOnce, rearm])

  return {
    pendingHref: pending?.kind === 'link' ? pending.href : null,
    pending: pending !== null,
    keepEditing,
    discard,
    allowNavigation: allowOnce
  }
}

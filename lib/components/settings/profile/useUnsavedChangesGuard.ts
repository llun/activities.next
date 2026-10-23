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
   * on purpose after the changes were saved or already confirmed away
   * (Cancel). It stays on until the guard unmounts.
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

type Pending =
  { kind: 'link'; href: string } | { kind: 'history'; delta: number }

// The Navigation API (where the browser has it) says how many history entries
// a Back or Forward moved, which `popstate` alone does not. It tells the change
// of the current entry before `popstate` fires.
interface NavigationLike extends EventTarget {
  currentEntry: { index: number } | null
}
const getNavigation = (): NavigationLike | null => {
  const navigation = (window as unknown as { navigation?: NavigationLike })
    .navigation
  return navigation ?? null
}

/**
 * Asks before the page is left with unsaved changes. A click on an in-app link
 * and the browser's Back and Forward are held back (the caller shows "Discard
 * changes?" while `pending`), and closing the tab, reloading or following an
 * outside link gets the browser's own prompt through `beforeunload`. Pass
 * `dirty` as false once the changes are saved: nothing is held back then.
 *
 * Back and Forward: the capture-phase `popstate` listener stops the event
 * before Next's router (which listens in the bubble phase) can start a
 * traversal, then sends the browser back to the entry it left, so the router
 * never notices. Discard replays the step with the guard off. This needs the
 * Navigation API to know the step's size and direction; a browser without it
 * keeps only the `beforeunload` prompt.
 */
export const useUnsavedChangesGuard = (dirty: boolean): UnsavedChangesGuard => {
  const router = useRouter()
  const [pending, setPending] = useState<Pending | null>(null)
  const allowed = useRef(false)
  // Read at the moment of the click or unload, not when an effect last ran: a
  // save that just finished must stand the guard down at once, before React has
  // got round to re-subscribing.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  // Allowing navigation (Discard, Cancel) is for the move being made. If the
  // person is still here editing again, the move did not leave: ask again.
  useEffect(() => {
    if (dirty) allowed.current = false
  }, [dirty])

  useEffect(() => {
    const navigation = getNavigation()
    let lastDelta = 0
    let restoring = false

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
    const onEntryChange = (event: Event) => {
      const from = (event as Event & { from?: { index: number } }).from
      const current = navigation?.currentEntry
      lastDelta = from && current ? current.index - from.index : 0
    }
    const onPopState = (event: PopStateEvent) => {
      if (restoring) {
        // Our own step back to the entry the person was on.
        restoring = false
        event.stopImmediatePropagation()
        return
      }
      if (!dirtyRef.current || allowed.current || lastDelta === 0) return
      event.stopImmediatePropagation()
      restoring = true
      window.history.go(-lastDelta)
      setPending({ kind: 'history', delta: lastDelta })
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('beforeunload', onBeforeUnload)
    if (navigation) {
      navigation.addEventListener('currententrychange', onEntryChange)
      window.addEventListener('popstate', onPopState, true)
    }
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
      navigation?.removeEventListener('currententrychange', onEntryChange)
      window.removeEventListener('popstate', onPopState, true)
    }
  }, [])

  const keepEditing = useCallback(() => setPending(null), [])
  const allowNavigation = useCallback(() => {
    allowed.current = true
  }, [])
  const discard = useCallback(() => {
    allowed.current = true
    const held = pending
    setPending(null)
    if (held?.kind === 'link') router.push(held.href)
    else if (held?.kind === 'history') window.history.go(held.delta)
  }, [pending, router])

  return {
    pendingHref: pending?.kind === 'link' ? pending.href : null,
    pending: pending !== null,
    keepEditing,
    discard,
    allowNavigation
  }
}

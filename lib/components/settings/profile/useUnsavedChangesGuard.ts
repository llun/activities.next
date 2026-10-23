'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UnsavedChangesGuard {
  /** The in-app link the person clicked while there were changes, if any. */
  pendingHref: string | null
  /** Closes the question and stays on the page ("Keep editing"). */
  keepEditing: () => void
  /** Follows the link that was held back ("Discard"). */
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
// link that only moves within the page.
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
  if (
    url.pathname === window.location.pathname &&
    url.search === window.location.search
  ) {
    return null
  }
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Asks before the page is left with unsaved changes. A click on an in-app link
 * is held back (the caller shows "Discard changes?" for `pendingHref`), and
 * closing the tab, reloading or following an outside link gets the browser's
 * own prompt through `beforeunload`. Pass `dirty` as false once the changes are
 * saved: nothing is held back then.
 */
export const useUnsavedChangesGuard = (dirty: boolean): UnsavedChangesGuard => {
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const allowed = useRef(false)
  // Read at the moment of the click or unload, not when an effect last ran: a
  // save that just finished must stand the guard down at once, before React has
  // got round to re-subscribing.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current || allowed.current) return
      const href = getInAppHref(event)
      if (!href) return
      // Capture phase on the document: runs before the link's own handler, so
      // Next's client navigation never starts.
      event.preventDefault()
      event.stopPropagation()
      setPendingHref(href)
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || allowed.current) return
      event.preventDefault()
      // Some browsers still need a return value to show the prompt.
      event.returnValue = ''
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  const keepEditing = useCallback(() => setPendingHref(null), [])
  const allowNavigation = useCallback(() => {
    allowed.current = true
  }, [])
  const discard = useCallback(() => {
    allowed.current = true
    const href = pendingHref
    setPendingHref(null)
    if (href) router.push(href)
  }, [pendingHref, router])

  return { pendingHref, keepEditing, discard, allowNavigation }
}

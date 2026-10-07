// Dependency-free so the click handler and its tests share one definition of
// "this click opens a profile".

// `/@username@domain`, the `[actor]` profile route. Sub-routes (a status,
// followers, fitness) have their own skeletons and are left alone.
const PROFILE_PATH = /^\/@[^/@]+@[^/@]+\/?$/

const decodePathname = (pathname: string): string | null => {
  try {
    return decodeURIComponent(pathname).replace(/\/$/, '')
  } catch {
    return null
  }
}

export const isProfilePathname = (pathname: string): boolean => {
  const decoded = decodePathname(pathname)
  return decoded !== null && PROFILE_PATH.test(decoded)
}

interface ClickLike {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}

interface LocationLike {
  origin: string
  pathname: string
}

/**
 * The profile pathname a click is about to navigate this tab to, or `null`
 * when the click is not a same-tab navigation to a different profile: a
 * modified or non-primary click (new tab/window, download), a link that opens
 * elsewhere, another origin, a non-profile route, or the profile already on
 * screen.
 *
 * Called from a capture-phase listener, so it runs before the link's own
 * handlers: `defaultPrevented` only catches a click something cancelled even
 * earlier. A profile link whose handler cancels the click without navigating
 * would leave the skeleton up until the provider's timeout, so do not build
 * one.
 */
export const getProfileNavigationTarget = (
  event: ClickLike,
  location: LocationLike
): string | null => {
  if (event.defaultPrevented || event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null
  }

  const target = event.target
  if (!target || typeof (target as Element).closest !== 'function') return null
  const anchor = (target as Element).closest('a')
  if (!anchor || !anchor.hasAttribute('href')) return null
  if (anchor.hasAttribute('download')) return null
  const anchorTarget = anchor.getAttribute('target')
  if (anchorTarget && anchorTarget !== '_self') return null

  let url: URL
  try {
    url = new URL(anchor.href, location.origin)
  } catch {
    return null
  }
  if (url.origin !== location.origin) return null
  if (!isProfilePathname(url.pathname)) return null
  if (decodePathname(url.pathname) === decodePathname(location.pathname)) {
    return null
  }

  return url.pathname
}

// Per-device acknowledgement of the route map's "green segments are hidden from
// other viewers" notice.
//
// The notice explains, once, why part of a viewer's own route is drawn in a
// different colour. It is an explanation rather than a legend, so a viewer who
// closes it has learned what green means and should not be told again — not on
// the next activity file, not in the next section, and not after a reload.
// Dismissal is therefore persisted per browser, alongside the theme mode and the
// announcement banner's collapse preference, rather than held in component
// state.
//
// There is deliberately no server-side counterpart: this is a UI hint, its scope
// is the device that saw it, and persisting it per account would need a schema
// change and a write on every dismissal to record something a reader can restore
// by clearing site data.
export const ROUTE_PRIVACY_NOTICE_STORAGE_KEY =
  'fitness:route-privacy-notice-dismissed'

const DISMISSED_VALUE = 'true'

// Both helpers are wrapped in try/catch because localStorage access throws
// outright in some privacy modes and sandboxed iframes — reading falls back to
// "not dismissed" (the notice still works, it just stops persisting) and a
// failed write is swallowed, since the caller keeps its own state for the
// current page view.

/**
 * Whether this browser has already acknowledged the notice. Callers must only
 * invoke this after mount: it reads `window`, and reading it during render would
 * make the server and client markup disagree.
 */
export const isRoutePrivacyNoticeDismissed = (): boolean => {
  if (typeof window === 'undefined') return false
  try {
    return (
      window.localStorage.getItem(ROUTE_PRIVACY_NOTICE_STORAGE_KEY) ===
      DISMISSED_VALUE
    )
  } catch {
    return false
  }
}

/** Records the acknowledgement so the notice stays closed on this browser. */
export const dismissRoutePrivacyNotice = (): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      ROUTE_PRIVACY_NOTICE_STORAGE_KEY,
      DISMISSED_VALUE
    )
  } catch {
    // Ignored — see the note above.
  }
}

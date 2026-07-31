// Per-device acknowledgement of the activity route map's "green segments are
// hidden from other viewers" notice.
//
// The notice explains, once, why part of a viewer's own route is drawn in a
// different colour. It is an explanation rather than a legend, so a viewer who
// closes it has learned what green means and should not be told again — not on
// the next activity file, not in the next section, and not after a reload.
// Dismissal is therefore persisted per browser, alongside the theme mode and the
// announcement banner's collapse preference, rather than held in component
// state.
//
// It is scoped to the ACTIVITY DETAIL map specifically. The heatmap surfaces
// (`RouteHeatmapMap`, the region detail, the shared page, the public embed) draw
// the same privacy distinction in blue and carry no notice today; if one is ever
// added there it must not be born pre-dismissed by this key, and its copy could
// not say "green" either.
//
// There is deliberately no server-side counterpart: this is a UI hint, its scope
// is the device that saw it, and persisting it per account would need a schema
// change and a write on every dismissal to record something a reader can restore
// by clearing site data.
const STORAGE_KEY_PREFIX = 'fitness:activity-route-privacy-notice-dismissed'

const DISMISSED_VALUE = 'true'

/**
 * The stored key for one actor. Hidden segments are served to the owning account
 * only (`includeHidden: isOwnerAccount` in the route-data route), so the notice
 * is always about the viewer's OWN route — on a shared browser an unscoped key
 * would let one account's dismissal swallow another account's first look at
 * their own redacted route. Privacy locations are configured per actor, so the
 * actor is the right unit. An actor-less viewer never sees hidden segments in
 * the first place; the bare prefix is just a defined fallback.
 */
export const getRoutePrivacyNoticeStorageKey = (
  actorId?: string | null
): string => (actorId ? `${STORAGE_KEY_PREFIX}:${actorId}` : STORAGE_KEY_PREFIX)

// Both helpers are wrapped in try/catch because localStorage access throws
// outright in some privacy modes and sandboxed iframes — reading falls back to
// "not dismissed" (the notice still works, it just stops persisting) and a
// failed write is swallowed, since the caller keeps its own state for the
// current page view.

/**
 * Whether this actor has already acknowledged the notice on this browser.
 * Callers must only invoke this after mount: it reads `window`, and reading it
 * during render would make the server and client markup disagree.
 */
export const isRoutePrivacyNoticeDismissed = (
  actorId?: string | null
): boolean => {
  if (typeof window === 'undefined') return false
  try {
    return (
      window.localStorage.getItem(getRoutePrivacyNoticeStorageKey(actorId)) ===
      DISMISSED_VALUE
    )
  } catch {
    return false
  }
}

/** Records the acknowledgement so the notice stays closed on this browser. */
export const dismissRoutePrivacyNotice = (actorId?: string | null): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      getRoutePrivacyNoticeStorageKey(actorId),
      DISMISSED_VALUE
    )
  } catch {
    // Ignored — see the note above.
  }
}

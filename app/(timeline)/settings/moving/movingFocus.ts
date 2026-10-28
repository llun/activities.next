// A move and a redirect cancel both end in router.refresh(), and the
// refreshed page swaps the MoveForm for the MovedNotice (or back). The
// component that is leaving cannot focus the one that arrives, and the
// dialog that closed returns focus to a button that is about to unmount,
// so focus would fall to the page body. The leaving component drops a
// note here instead, and the arriving one takes it on mount and focuses
// its own Alert. A plain page load finds nothing, so focus stays where
// the browser put it.

export type MovingFocusTarget = 'moved-notice' | 'move-form'

let pending: MovingFocusTarget | null = null

export const requestMovingFocus = (target: MovingFocusTarget) => {
  pending = target
}

/**
 * Whether this mount is the answer to the given target's last action, and
 * focus belongs on the new state. The request is consumed either way, so a
 * later mount never re-runs it.
 */
export const takeMovingFocus = (target: MovingFocusTarget): boolean => {
  if (pending !== target) return false
  pending = null
  return true
}

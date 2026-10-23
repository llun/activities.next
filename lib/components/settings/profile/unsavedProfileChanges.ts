// Whether an Edit profile page on screen has unsaved changes. The editor sets
// it; the actor switcher reads it before it changes the session, so a switch
// the person cancels never happens. Module state is enough: there is one
// editor per page and the switcher lives in the same document.
let unsaved = false
// A confirmed discard that is about to reload the page: the guard's
// `beforeunload` prompt would ask a second time, so it stands down.
let unloadAllowed = false

export const setUnsavedProfileChanges = (value: boolean) => {
  unsaved = value
  // A fresh edit, or a page with nothing left to lose, ends any earlier answer.
  unloadAllowed = false
}

export const hasUnsavedProfileChanges = () => unsaved

/** Whether the person already confirmed losing the changes by reloading. */
export const isProfileUnloadAllowed = () => unloadAllowed

/**
 * Takes the confirmation back, because the switch or creation it was for
 * failed and the page stays: the guard asks again on a later unload.
 */
export const revokeProfileUnloadAllowance = () => {
  unloadAllowed = false
}

/**
 * Asks "Discard changes?" when the Edit profile page has unsaved changes.
 * True when the switch may go ahead.
 */
export const confirmDiscardProfileChanges = (): boolean => {
  if (!unsaved) return true
  const confirmed = window.confirm(
    'Discard changes? You have unsaved changes to your profile, and they will be lost.'
  )
  // No time limit: creating a profile and switching to it can take a while,
  // and the reload that follows must not ask again.
  if (confirmed) unloadAllowed = true
  return confirmed
}

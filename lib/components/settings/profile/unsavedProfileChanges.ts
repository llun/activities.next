// Whether an Edit profile page on screen has unsaved changes. The editor sets
// it; the actor switcher reads it before it changes the session, so a switch
// the person cancels never happens. Module state is enough: there is one
// editor per page and the switcher lives in the same document.
let unsaved = false

export const setUnsavedProfileChanges = (value: boolean) => {
  unsaved = value
}

export const hasUnsavedProfileChanges = () => unsaved

/**
 * Asks "Discard changes?" when the Edit profile page has unsaved changes.
 * True when the switch may go ahead.
 */
export const confirmDiscardProfileChanges = (): boolean =>
  !unsaved ||
  window.confirm(
    'Discard changes? You have unsaved changes to your profile, and they will be lost.'
  )

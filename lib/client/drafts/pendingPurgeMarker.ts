/**
 * Accounts that signed out here but whose drafts could not be deleted yet.
 * Kept outside IndexedDB, because that is the store whose failure left the
 * drafts behind. Sign-out is the only writer, and only after the server
 * confirmed it, so a failed sign-out never schedules a purge. Free of IndexedDB
 * code, so sign-out writes the marker before it loads anything that can fail.
 */
const STORAGE_KEY = 'activities-drafts-pending-purge'

export const readPendingPurges = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '[]'
    )
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    return []
  }
}

const writePending = (accountIds: string[]) => {
  try {
    if (accountIds.length > 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(accountIds))
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Without localStorage the purge cannot be remembered; it was still tried.
  }
}

/** Records an account whose drafts are still to be deleted. */
export const markPurgePending = (accountId: string): void => {
  const pending = readPendingPurges()
  if (!pending.includes(accountId)) writePending([...pending, accountId])
}

/** The account's drafts are gone: only the other pending accounts stay. */
export const settlePurge = (accountId: string): void =>
  writePending(readPendingPurges().filter((id) => id !== accountId))

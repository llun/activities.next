import { deleteAccountDrafts } from './draftsDb'

/**
 * Accounts that signed out here but whose drafts could not be deleted yet.
 * Kept outside IndexedDB, because that is the store whose failure left the
 * drafts behind. Sign-out is the only writer, and only after the server
 * confirmed it, so a failed sign-out never schedules a purge.
 */
const STORAGE_KEY = 'activities-drafts-pending-purge'

const readPending = (): string[] => {
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

const settle = (accountId: string) =>
  writePending(readPending().filter((id) => id !== accountId))

/**
 * Deletes an account's drafts after a confirmed sign-out. The account is
 * recorded first, so a failure (or a tab closed mid-delete) leaves a pending
 * purge that `runPendingPurges` finishes on the next app load. Never throws.
 */
export const purgeAccountDrafts = async (accountId: string): Promise<void> => {
  const pending = readPending()
  if (!pending.includes(accountId)) writePending([...pending, accountId])
  try {
    await deleteAccountDrafts(accountId)
    settle(accountId)
  } catch {
    // Stays pending: retried when `DraftsProvider` next mounts.
  }
}

let inFlight: Promise<void> | null = null

/**
 * Retries every pending purge, whichever account is signed in now (a shared
 * device may have another user). Resolves once all attempts settled; an account
 * that still fails stays pending. Does nothing when none is pending. A call
 * while another is running joins it, so a remount (React StrictMode) or a
 * second provider never purges, and bumps the epoch, twice.
 */
export const runPendingPurges = (): Promise<void> => {
  inFlight ??= Promise.all(
    readPending().map(async (accountId) => {
      try {
        await deleteAccountDrafts(accountId)
        settle(accountId)
      } catch {
        // Stays pending for the next load.
      }
    })
  )
    .then(() => undefined)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

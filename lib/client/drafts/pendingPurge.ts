import { deleteAccountDrafts } from './draftsDb'
import {
  markPurgePending,
  readPendingPurges,
  settlePurge
} from './pendingPurgeMarker'

/**
 * Deletes an account's drafts after a confirmed sign-out. The account is
 * recorded first, so a failure (or a tab closed mid-delete) leaves a pending
 * purge that `runPendingPurges` finishes on the next app load. Never throws.
 */
export const purgeAccountDrafts = async (accountId: string): Promise<void> => {
  markPurgePending(accountId)
  try {
    await deleteAccountDrafts(accountId)
    settlePurge(accountId)
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
    readPendingPurges().map(async (accountId) => {
      try {
        await deleteAccountDrafts(accountId)
        settlePurge(accountId)
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

'use client'

import { useCallback, useState } from 'react'

import { postDraftsMessage } from '@/lib/client/drafts/draftsChannel'
import { markPurgePending } from '@/lib/client/drafts/pendingPurgeMarker'
import { clearAllOfflineData } from '@/lib/client/offline'
import { useDrafts } from '@/lib/components/drafts/DraftsProvider'
import { authClient } from '@/lib/services/auth/auth-client'

export function useSignOut(): {
  signOut: () => Promise<void>
  signingOut: boolean
  error: string | null
  clearError: () => void
} {
  const accountId = useDrafts()?.accountId
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const signOut = useCallback(async () => {
    setSigningOut(true)
    setError(null)

    // Other tabs stop autosaving now; the account epoch stops anything already
    // in flight. Only an explicit sign-out deletes this account's drafts, and
    // only once the server has confirmed it, so a failed sign-out keeps them.
    if (accountId) postDraftsMessage({ type: 'signing-out', accountId })
    try {
      await clearAllOfflineData()
    } catch {
      // safe fallback
    }
    const failed = () => {
      if (accountId) {
        postDraftsMessage({ type: 'sign-out-cancelled', accountId })
      }
      setError('Sign out failed. Please try again.')
      setSigningOut(false)
    }
    try {
      // A network failure rejects without calling either callback, so without
      // the catch every tab would stay in `signing-out` with autosave off.
      await authClient.signOut({
        fetchOptions: {
          // The server has signed out: whatever happens to the drafts, the
          // redirect follows. The marker is written before the drafts code
          // loads, so a chunk that fails to load still leaves the purge for
          // `DraftsProvider` to finish on the next app load.
          onSuccess: async () => {
            if (accountId) {
              markPurgePending(accountId)
              try {
                await (
                  await import('@/lib/client/drafts')
                ).purgeAccountDrafts(accountId)
              } catch {
                // Stays pending.
              }
            }
            window.location.href = '/auth/signin'
          },
          onError: failed
        }
      })
    } catch {
      failed()
    }
  }, [accountId])

  return { signOut, signingOut, error, clearError }
}

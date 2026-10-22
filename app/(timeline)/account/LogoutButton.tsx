'use client'

import { useState } from 'react'

import { postDraftsMessage } from '@/lib/client/drafts/draftsChannel'
import { markPurgePending } from '@/lib/client/drafts/pendingPurgeMarker'
import { clearAllOfflineData } from '@/lib/client/offline'
import { useDrafts } from '@/lib/components/drafts/DraftsProvider'
import { ConfirmDialog } from '@/lib/components/photo-editor/ConfirmDialog'
import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'
import { cn } from '@/lib/utils'

// A failed sign-out goes to `onError`, so the page shows its Alert beside the
// box this button sits in rather than inside it.
export const LogoutButton = ({
  describedBy,
  labelledBy,
  className,
  onError
}: {
  describedBy?: string
  labelledBy?: string
  className?: string
  onError: (message: string | null) => void
}) => {
  const accountId = useDrafts()?.accountId
  const [unsentCount, setUnsentCount] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const signOut = async () => {
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
      onError('Sign out failed. Please try again.')
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
  }

  const handleClick = async () => {
    onError(null)
    // Unavailable storage means there is nothing to count, so nothing to ask.
    const count = accountId
      ? await import('@/lib/client/drafts')
          .then((m) => m.countDrafts({ accountId }))
          .catch(() => 0)
      : 0
    if (count === 0) return signOut()
    setUnsentCount(count)
    setConfirmOpen(true)
  }

  return (
    <div className={cn('sm:flex sm:justify-end', className)}>
      <Button
        variant="outline"
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        onClick={handleClick}
      >
        Logout
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${unsentCount} unsent ${unsentCount === 1 ? 'post' : 'posts'}?`}
        description="These posts are saved only on this device. Signing out deletes them."
        cancelLabel="Keep me signed in"
        confirmLabel="Sign out and delete"
        destructive
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          void signOut()
        }}
      />
    </div>
  )
}

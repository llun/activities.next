'use client'

import { clearAllOfflineData } from '@/lib/client/offline'
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
  const handleSignOut = async () => {
    onError(null)
    try {
      await clearAllOfflineData()
    } catch {
      // safe fallback
    }
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = '/auth/signin'
        },
        onError: () => {
          onError('Sign out failed. Please try again.')
        }
      }
    })
  }

  return (
    <div className={cn('sm:flex sm:justify-end', className)}>
      <Button
        variant="outline"
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        onClick={handleSignOut}
      >
        Logout
      </Button>
    </div>
  )
}

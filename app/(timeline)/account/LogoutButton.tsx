'use client'

import { useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

export const LogoutButton = ({ describedBy }: { describedBy?: string }) => {
  const [error, setError] = useState<string>()

  const handleSignOut = () => {
    setError(undefined)
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = '/auth/signin'
        },
        onError: () => {
          setError('Sign out failed. Please try again.')
        }
      }
    })
  }

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        aria-describedby={describedBy}
        onClick={handleSignOut}
      >
        Logout
      </Button>
      {error && <p className="text-destructive-text text-sm">{error}</p>}
    </div>
  )
}

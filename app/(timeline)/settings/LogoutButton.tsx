'use client'

import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

export const LogoutButton = () => {
  const handleSignOut = () => {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = '/auth/signin'
        },
        onError: () => {
          alert('Sign out failed. Please try again.')
        }
      }
    })
  }

  return (
    <Button variant="outline" onClick={handleSignOut}>
      Logout
    </Button>
  )
}

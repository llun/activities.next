'use client'

import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

export const LogoutButton = () => (
  <Button
    variant="outline"
    onClick={() =>
      authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = '/auth/signin'
          },
          onError: () => {
            window.location.href = '/auth/signin'
          }
        }
      })
    }
  >
    Logout
  </Button>
)

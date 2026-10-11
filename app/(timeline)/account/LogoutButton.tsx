'use client'

import { useState } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'
import { cn } from '@/lib/utils'

export const LogoutButton = ({
  describedBy,
  labelledBy,
  className
}: {
  describedBy?: string
  labelledBy?: string
  className?: string
}) => {
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
    <div className={cn('space-y-1', className)}>
      <div className="sm:flex sm:justify-end">
        <Button
          variant="outline"
          aria-describedby={describedBy}
          aria-labelledby={labelledBy}
          onClick={handleSignOut}
        >
          Logout
        </Button>
      </div>
      {error && <Alert title={error} />}
    </div>
  )
}

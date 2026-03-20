'use client'

import { Bell } from 'lucide-react'
import Link from 'next/link'
import { FC, useState } from 'react'

import { Logo } from '@/lib/components/layout/logo'
import { NotificationBadge } from '@/lib/components/notification-badge/NotificationBadge'
import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

interface Props {
  isLoggedIn?: boolean
  followRequestCount?: number
}

export const Header: FC<Props> = ({
  isLoggedIn = false,
  followRequestCount = 0
}) => {
  const [error, setError] = useState<string>()

  return (
    <header className="navbar navbar-expand-lg bg-light">
      <nav className="container">
        <Logo size="md" className="navbar-brand" />
        {isLoggedIn && (
          <div className="d-flex justify-content-start">
            <Button variant="link">
              <Link prefetch={false} href={'/'}>
                Timeline
              </Link>
            </Button>

            <Button variant="link" asChild>
              <Link
                prefetch={false}
                href={'/notifications'}
                className="relative"
              >
                <Bell className="size-5" />
                <NotificationBadge count={followRequestCount} />
              </Link>
            </Button>

            <Button variant="link">
              <Link prefetch={false} href={'/settings'}>
                Settings
              </Link>
            </Button>

            <div className="flex flex-col items-start">
              <Button
                variant="outline"
                onClick={() => {
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
                }}
              >
                Logout
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>
        )}
      </nav>
    </header>
  )
}

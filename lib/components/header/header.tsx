'use client'

import { Bell } from 'lucide-react'
import { Session } from 'next-auth'
import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { FC } from 'react'

import { NotificationBadge } from '../notification-badge/NotificationBadge'
import { Button } from '../ui/button'

interface Props {
  session?: Session | null
  followRequestCount?: number
}

export const Header: FC<Props> = ({ session, followRequestCount = 0 }) => {
  const isLoggedIn = Boolean(session?.user)

  return (
    <header className="navbar navbar-expand-lg bg-light">
      <nav className="container">
        <Link prefetch={false} className="navbar-brand" href={'/'}>
          Activities
        </Link>
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

            <Button variant="outline" onClick={() => signOut()}>
              Logout
            </Button>
          </div>
        )}
      </nav>
    </header>
  )
}

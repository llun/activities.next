'use client'

import { Session } from 'next-auth'
import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { FC } from 'react'

import { Button } from './Button'

interface Props {
  session?: Session | null
}

export const Header: FC<Props> = ({ session }) => {
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

            <Button variant="link">
              <Link prefetch={false} href={'/settings'}>
                Settings
              </Link>
            </Button>

            <Button outline onClick={() => signOut()}>
              Logout
            </Button>
          </div>
        )}
      </nav>
    </header>
  )
}

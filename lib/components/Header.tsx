import { Session } from 'next-auth'
import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { FC } from 'react'

import { Button } from './Button'

interface Props {
  session?: Session | null
}

export const Header: FC<Props> = ({ session }) => {
  return (
    <header className="navbar navbar-expand-lg bg-light">
      <nav className="container">
        <Link prefetch={false} className="navbar-brand" href={'/'}>
          Activities
        </Link>
        {session?.user?.email && (
          <Button outline onClick={() => signOut()}>
            Logout
          </Button>
        )}
      </nav>
    </header>
  )
}

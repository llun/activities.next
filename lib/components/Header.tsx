import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { FC } from 'react'
import { Button } from './Button'
import { Session } from 'next-auth'

interface Props {
  session?: Session | null
}

export const Header: FC<Props> = ({ session }) => {
  return (
    <header className="navbar navbar-expand-lg bg-light">
      <nav className="container">
        <Link className="navbar-brand" href={'/'}>
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

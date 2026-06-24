import { FC, ReactNode } from 'react'

import { PublicShell } from '@/app/(timeline)/PublicShell'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

interface LayoutProps {
  children: ReactNode
}

/**
 * A collection with a public projection is viewable while logged out (the
 * shareable link). Signed-in visitors already get the nav sidebar from the
 * `(timeline)` layout, so this only adds the public top bar + footer chrome for
 * logged-out visitors; signed-in renders pass through untouched. Owner-only
 * routes (`new`, `[id]/edit`) redirect anonymous visitors to sign in from their
 * own page, so wrapping them here is harmless.
 */
const Layout: FC<LayoutProps> = async ({ children }) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (actor) return <>{children}</>

  return <PublicShell>{children}</PublicShell>
}

export default Layout

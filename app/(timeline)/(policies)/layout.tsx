import { FC, ReactNode } from 'react'

import { PublicShell } from '@/app/(timeline)/PublicShell'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

interface LayoutProps {
  children: ReactNode
}

/**
 * The terms of service and privacy policy are public: they are what a visitor
 * reads before creating an account. Signed-in visitors already get the nav
 * sidebar from the `(timeline)` layout, so this only adds the public top bar
 * (the page prints its own footer) for logged-out visitors, like
 * `[actor]/layout.tsx`; signed-in renders only gain the top spacing the shell
 * would have given (below `md` the page's own compact bar sits at the top, with
 * a `mt-6` gap under it).
 */
const Layout: FC<LayoutProps> = async ({ children }) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  // The `(timeline)` content wrapper has no top padding, which the public
  // shell's `py-6` supplies for logged-out visitors; the profile page takes the
  // same `md:pt-8` when signed in. Below `md` the page renders
  // `MobileCompactHeader` first (it is the h1 there, so the article's h1 is
  // hidden below `md`), so the gap goes under it, not above.
  if (actor)
    return (
      <div className="md:pt-8 max-md:[&>article]:mt-6 max-md:[&>article>h1]:hidden">
        {children}
      </div>
    )

  return <PublicShell footer={false}>{children}</PublicShell>
}

export default Layout

import { FC, ReactNode } from 'react'

import { Modal } from '@/app/Modal'
import { MobileNav } from '@/lib/components/layout/mobile-nav'
import { Sidebar } from '@/lib/components/layout/sidebar'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile, getMention } from '@/lib/types/domain/actor'
import { cn } from '@/lib/utils'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { PublicFooter } from './PublicFooter'
import { PublicTopBar } from './PublicTopBar'

interface LayoutProps {
  children: ReactNode
}

const Layout: FC<LayoutProps> = async ({ children }) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)

  // Logged-out visitors get the public chrome — a slim top bar with sign-in
  // CTAs and a footer in place of the nav sidebar — matching the web-public
  // design. The reading column is narrower than the signed-in app width.
  if (!actor) {
    return (
      // min-h-dvh (dynamic viewport height) rather than min-h-screen/100vh so
      // the footer stays at the bottom without a mobile address-bar gap — same
      // rationale as the public error pages (lib/components/error-page.tsx).
      <div className="flex min-h-dvh flex-col">
        <PublicTopBar />
        <main className="flex flex-1 flex-col overflow-x-clip">
          <div className="mx-auto flex w-full max-w-[680px] flex-1 flex-col px-4 py-6">
            {children}
          </div>
        </main>
        {/* Footer is a sibling of <main> (not nested in it) so its <footer>
            maps to the contentinfo landmark; main keeps flex-1 to pin it to the
            bottom on short pages. */}
        <PublicFooter />
        <Modal />
      </div>
    )
  }

  // Check if iconUrl is a real user-uploaded avatar (not auto-generated)
  // Auto-generated URLs typically contain service identifiers
  const isRealAvatar = (url?: string) => {
    if (!url) return false
    // Skip if URL is from known auto-generation services
    if (url.includes('gravatar')) return false
    if (url.includes('ui-avatars')) return false
    if (url.includes('robohash')) return false
    if (url.includes('dicebear')) return false
    if (url.includes('boringavatars')) return false
    // Skip if URL appears to be a default/placeholder
    if (url.includes('default')) return false
    if (url.includes('placeholder')) return false
    return true
  }

  // From here on the visitor is signed in (the logged-out branch returned
  // above), so the nav chrome always renders.
  const user = {
    name: actor.name || actor.username,
    username: actor.username,
    handle: getMention(getActorProfile(actor), true),
    avatarUrl: isRealAvatar(actor.iconUrl) ? actor.iconUrl : undefined
  }

  // Get all actors for the account
  const actors = actor.account?.id
    ? await database.getActorsForAccount({ accountId: actor.account.id })
    : []

  const currentActor = {
    id: actor.id,
    username: actor.username,
    domain: actor.domain,
    name: actor.name,
    iconUrl: isRealAvatar(actor.iconUrl) ? actor.iconUrl : null
  }

  const unreadCount = await database.getNotificationsCount({
    actorId: actor.id,
    onlyUnread: true
  })

  // Fitness is a first-class section for every signed-in local account (like
  // Bookmarks/Messages), so new users can discover the import/Strava setup even
  // before they have any activity. The Overview itself handles the empty state.
  const fitnessUrl = actor.account ? '/fitness' : undefined
  const isAdmin = actor.account?.role === 'admin'

  return (
    <div className="min-h-dvh">
      <Sidebar
        user={user}
        currentActor={currentActor}
        actors={actors.map((a) => ({
          id: a.id,
          username: a.username,
          domain: a.domain,
          name: a.name,
          iconUrl: isRealAvatar(a.iconUrl) ? a.iconUrl : null,
          deletionStatus: a.deletionStatus ?? null,
          deletionScheduledAt: a.deletionScheduledAt ?? null
        }))}
        unreadCount={unreadCount}
        fitnessUrl={fitnessUrl}
        isAdmin={isAdmin}
      />
      <MobileNav
        unreadCount={unreadCount}
        fitnessUrl={fitnessUrl}
        profileUrl={`/${user.handle}`}
        isAdmin={isAdmin}
      />
      <main
        className={cn(
          'flex min-h-dvh flex-col overflow-x-clip pb-6',
          'pb-20 md:pl-[72px] md:pb-0 md:[--sidebar-w:72px] xl:pl-[280px] xl:[--sidebar-w:280px]'
        )}
      >
        <div className="mx-auto flex w-full max-w-content flex-1 flex-col px-4 pb-6">
          {children}
        </div>
      </main>
      <Modal />
    </div>
  )
}

export default Layout

import { FC, ReactNode } from 'react'

import { Modal } from '@/app/Modal'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { MobileNav } from '@/lib/components/layout/mobile-nav'
import { Sidebar } from '@/lib/components/layout/sidebar'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { getActorProfile, getMention } from '@/lib/types/domain/actor'
import { cn } from '@/lib/utils'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

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

  // The admin-configurable limits the browser needs. Published once here so the
  // composer's character counter and the media picker's size check reflect the
  // resolved settings on every surface, without threading a prop through each
  // page (the composer renders inline under posts across the whole group).
  // Both branches provide it so no descendant can end up outside the provider.
  const {
    posts: { maxCharacters },
    media: { maxFileSize }
  } = await getResolvedServerSettings(database)

  // Logged-out visitors render without the nav sidebar. The home route renders
  // a full-bleed landing (see app/(timeline)/page.tsx), so this branch stays
  // chrome-less; the federated reading surfaces that still need the public top
  // bar + footer (single status, profiles, hashtags) wrap themselves in
  // `PublicShell` via their own sub-layouts (`[actor]/layout.tsx`,
  // `tags/layout.tsx`).
  if (!actor) {
    return (
      <InstanceLimitsProvider
        maxStatusCharacters={maxCharacters}
        maxMediaFileSize={maxFileSize}
      >
        {children}
      </InstanceLimitsProvider>
    )
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

  // Drives the expandable Lists group in the sidebar.
  const lists = await database.getLists({ actorId: actor.id })

  return (
    <InstanceLimitsProvider
      maxStatusCharacters={maxCharacters}
      maxMediaFileSize={maxFileSize}
    >
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
          lists={lists.map((list) => ({ id: list.id, title: list.title }))}
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
    </InstanceLimitsProvider>
  )
}

export default Layout

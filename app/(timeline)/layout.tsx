import { getServerSession } from 'next-auth'
import { FC, ReactNode } from 'react'

import { Modal } from '@/app/Modal'
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { MobileNav } from '@/lib/components/layout/mobile-nav'
import { Sidebar } from '@/lib/components/layout/sidebar'
import { getDatabase } from '@/lib/database'
import { getActorProfile, getMention } from '@/lib/models/actor'
import { cn } from '@/lib/utils'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

interface LayoutProps {
  children: ReactNode
}

const Layout: FC<LayoutProps> = async ({ children }) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerSession(getAuthOptions())
  const actor = await getActorFromSession(database, session)

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

  const user = actor
    ? {
        name: actor.name || actor.username,
        username: actor.username,
        handle: getMention(getActorProfile(actor), true),
        avatarUrl: isRealAvatar(actor.iconUrl) ? actor.iconUrl : undefined
      }
    : undefined
  const showNavigation = Boolean(user)

  // Get all actors for the account
  const actors = actor?.account?.id
    ? await database.getActorsForAccount({ accountId: actor.account.id })
    : []

  const currentActor = actor
    ? {
        id: actor.id,
        username: actor.username,
        domain: actor.domain,
        name: actor.name,
        iconUrl: isRealAvatar(actor.iconUrl) ? actor.iconUrl : null
      }
    : undefined

  // Get unread notifications count
  const unreadCount = actor
    ? await database.getNotificationsCount({
        actorId: actor.id,
        onlyUnread: true
      })
    : 0

  return (
    <div className="min-h-screen">
      {showNavigation && (
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
        />
      )}
      {showNavigation && <MobileNav unreadCount={unreadCount} />}
      <main
        className={cn(
          'pb-6',
          showNavigation && 'pb-20 md:pl-[72px] md:pb-0 xl:pl-[280px]'
        )}
      >
        <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
      </main>
      <Modal />
    </div>
  )
}

export default Layout

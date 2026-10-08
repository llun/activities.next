'use client'

import { ActorInfo } from '@/lib/components/actor-switcher/ActorSwitcher'
import { MobileNavigationDrawer } from '@/lib/components/layout/mobile-navigation-drawer'
import { Sidebar, UserList } from '@/lib/components/layout/sidebar'
import { type NavFeatureFlags } from '@/lib/services/navigation/navPreferences'

export interface MobileNavProps {
  user?: {
    handle: string
    name: string
    username: string
    avatarUrl?: string
  } | null
  currentActor?: ActorInfo | null
  actors?: ActorInfo[]
  unreadCount?: number
  fitnessUrl?: string
  galleryUrl?: string
  isAdmin?: boolean
  lists?: UserList[]
  features?: Partial<NavFeatureFlags>
}

/**
 * The signed-in mobile navigation drawer: the shared drawer shell around the
 * same `Sidebar` the desktop renders, so the registry order, the More group,
 * account switching, role/feature gating and the Notifications unread count
 * all come from one place.
 */
export function MobileNav({
  user,
  currentActor,
  actors,
  unreadCount = 0,
  fitnessUrl,
  galleryUrl,
  isAdmin = false,
  lists,
  features
}: MobileNavProps) {
  return (
    <MobileNavigationDrawer>
      {(onNavigate) => (
        <Sidebar
          variant="drawer"
          user={user}
          currentActor={currentActor}
          actors={actors}
          unreadCount={unreadCount}
          fitnessUrl={fitnessUrl}
          galleryUrl={galleryUrl}
          isAdmin={isAdmin}
          lists={lists}
          features={features}
          onNavigate={onNavigate}
        />
      )}
    </MobileNavigationDrawer>
  )
}

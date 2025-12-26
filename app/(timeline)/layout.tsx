import { getServerSession } from 'next-auth'
import { FC, ReactNode } from 'react'

import { Modal } from '@/app/Modal'
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { MobileNav } from '@/lib/components/layout/mobile-nav'
import { Sidebar } from '@/lib/components/layout/sidebar'
import { getDatabase } from '@/lib/database'
import { getActorProfile, getMention } from '@/lib/models/actor'
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
        handle: getMention(getActorProfile(actor)),
        avatarUrl: isRealAvatar(actor.iconUrl) ? actor.iconUrl : undefined
      }
    : undefined

  return (
    <div className="min-h-screen">
      <Sidebar user={user} />
      <MobileNav />
      <main className="pb-20 md:pl-[72px] md:pb-0 xl:pl-[280px]">
        <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
      </main>
      <Modal />
    </div>
  )
}

export default Layout
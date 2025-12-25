import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
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
  if (!actor) {
    return redirect('/auth/signin')
  }

  const profile = getActorProfile(actor)
  const user = {
    name: profile.name || profile.username,
    handle: `@${getMention(profile)}`,
    avatarUrl: profile.iconUrl
  }

  return (
    <div className="min-h-screen">
      <Sidebar user={user} />
      <MobileNav />
      <main className="md:pl-[72px] xl:pl-[280px] pb-20 md:pb-0">
        <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
      </main>
      <Modal />
    </div>
  )
}

export default Layout

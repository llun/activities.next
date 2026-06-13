import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AnnouncementsPanel } from '@/lib/components/admin-announcements/AnnouncementsPanel'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Announcements'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  // Pass the wall clock as a number (never a Date) so the panel can compute
  // lifecycle status badges without a hydration mismatch.
  return <AnnouncementsPanel currentTime={Date.now()} />
}

export default Page

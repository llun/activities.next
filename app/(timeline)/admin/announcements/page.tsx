import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AnnouncementsPanel } from '@/lib/components/admin-announcements/AnnouncementsPanel'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminDomainList } from '@/lib/services/domains/adminDomains'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { normalizeServedDomainChoice } from '@/lib/utils/host'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Announcements'
}

interface Props {
  searchParams: Promise<{ domain?: string | string[] }>
}

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const { domains } = await getAdminDomainList(database)
  const { domain: rawDomain } = await searchParams
  const preset = normalizeServedDomainChoice(
    (Array.isArray(rawDomain) ? rawDomain[0] : rawDomain) ?? ''
  )

  // Pass the wall clock as a number (never a Date) so the panel can compute
  // lifecycle status badges without a hydration mismatch.
  return (
    <AnnouncementsPanel
      currentTime={Date.now()}
      servedDomains={domains.map((item) => item.domain)}
      primaryDomain={domains.find((item) => item.source === 'primary')?.domain}
      presetDomain={preset}
    />
  )
}

export default Page

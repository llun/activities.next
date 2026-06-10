import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { FiltersPanel } from '@/lib/components/filters/FiltersPanel'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Server filters'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  return <FiltersPanel scope="server" currentTime={Date.now()} />
}

export default Page

import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const metadata = { title: 'Admin' }

export const dynamic = 'force-dynamic'

// The layout renders the grouped index; the page itself is only the guard.
const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  return null
}

export default Page

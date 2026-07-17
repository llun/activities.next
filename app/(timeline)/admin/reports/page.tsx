import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import { AdminReportsList } from './AdminReportsList'

export const dynamic = 'force-dynamic'

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Review and resolve moderation reports."
      />
      <AdminReportsList />
    </div>
  )
}

export default Page

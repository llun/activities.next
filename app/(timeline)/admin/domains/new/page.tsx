import { redirect } from 'next/navigation'

import { AddDomainForm } from '@/lib/components/admin/domains/AddDomainForm'
import { BackLink } from '@/lib/components/back-link'
import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 max-md:flex-col max-md:gap-1">
        <BackLink
          href="/admin/domains"
          accessibleName="Back to domains"
          iconOnlyFrom="md"
          className="md:rounded-lg md:p-2 md:hover:bg-muted"
        />
        <PageHeader
          className="min-w-0 flex-1"
          title="Add domain"
          description="Serve profiles on another domain. Set up DNS, TLS and your proxy for it first."
        />
      </div>
      <AddDomainForm />
    </div>
  )
}

export default Page

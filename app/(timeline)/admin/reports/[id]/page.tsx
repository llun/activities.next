import { redirect } from 'next/navigation'

import { BackLink } from '@/lib/components/back-link'
import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import { AdminReportDetail } from './AdminReportDetail'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

const Page = async ({ params }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const { id } = await params

  return (
    <div className="space-y-6">
      {/* Below md the Back is its own labelled row above the heading; from
          md up it is the icon beside the heading it always was. */}
      <div className="flex items-start gap-3 max-md:flex-col max-md:gap-1">
        <BackLink
          href="/admin/reports"
          label="Back to reports"
          accessibleName="Back to reports list"
          iconOnlyFrom="md"
          className="md:rounded-lg md:p-2 md:hover:bg-muted"
        />
        <PageHeader className="flex-1" title="Report" />
      </div>
      <AdminReportDetail reportId={id} />
    </div>
  )
}

export default Page

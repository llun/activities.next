import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminDomainList } from '@/lib/services/domains/adminDomains'
import {
  OPEN_REPORTS_FETCH_LIMIT,
  countOpenReports
} from '@/lib/services/domains/openReports'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { normalizeServedDomainChoice } from '@/lib/utils/host'

import { AdminReportsList } from './AdminReportsList'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ domain?: string | string[] }>
}

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  // The Domain select and column show only while more than one domain is
  // served; the filter itself takes any served domain.
  const { domains } = await getAdminDomainList(database)
  const servedDomains = domains.map((item) => item.domain)
  const { domain: rawDomain } = await searchParams
  const requested = normalizeServedDomainChoice(
    (Array.isArray(rawDomain) ? rawDomain[0] : rawDomain) ?? ''
  )
  const domain =
    requested && servedDomains.includes(requested) ? requested : null
  const { count: open, capped } = countOpenReports(
    domain
      ? (
          await database.getAdminReports({
            domain,
            resolved: false,
            limit: OPEN_REPORTS_FETCH_LIMIT
          })
        ).length
      : 0
  )

  return (
    <div className="space-y-6">
      <PageHeader
        compactTitle="Reports"
        title={
          domain ? (
            <>
              Reports on <span className="break-all">{domain}</span>
            </>
          ) : (
            'Reports'
          )
        }
        description={
          domain ? (
            <>
              {capped ? `${open}+` : open}{' '}
              {open === 1 ? 'open report' : 'open reports'} about profiles on{' '}
              <span className="break-all">{domain}</span>.
            </>
          ) : (
            'Review and resolve moderation reports.'
          )
        }
      />
      <AdminReportsList servedDomains={servedDomains} domain={domain} />
    </div>
  )
}

export default Page

import { notFound, redirect } from 'next/navigation'

import { computeAnnouncementStatus } from '@/lib/components/admin-announcements/announcementStatus'
import {
  DomainPageScope,
  DomainSettings
} from '@/lib/components/admin/domains/DomainSettings'
import { getDatabase } from '@/lib/database'
import { getAdminAnnouncement } from '@/lib/services/announcements/adminAnnouncement'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { readDomainRouteParam } from '@/lib/services/domains/adminDomainTypes'
import {
  getAdminDomain,
  getEnvDomains,
  getServerIdentityView
} from '@/lib/services/domains/adminDomains'
import { getAdminRule } from '@/lib/services/rules/adminRule'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const isShowing = (
  announcement: {
    published: boolean
    startsAt: number | null
    endsAt: number | null
  },
  currentTime: number
): boolean => {
  const { status } = computeAnnouncementStatus(
    {
      published: announcement.published,
      starts_at: announcement.startsAt,
      ends_at: announcement.endsAt
    },
    currentTime
  )
  return status === 'published' || status === 'scheduled'
}

// The open-report count is the length of one capped page of the queue.
const OPEN_REPORTS_LIMIT = 1000

interface Props {
  params: Promise<{ domain: string }>
}

const Page = async ({ params }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const [domain, server] = await Promise.all([
    params.then(({ domain }) =>
      getAdminDomain(database, readDomainRouteParam(domain))
    ),
    getServerIdentityView(database)
  ])
  if (!domain) return notFound()

  const isPrimary = domain.source === 'primary'
  const currentTime = Date.now()
  const [
    serverRules,
    ownRules,
    announcements,
    everyDomainAnnouncements,
    reports,
    settings
  ] = await Promise.all([
    database.getOwnInstanceRules({ domain: null }),
    // The primary has no rules of its own: its rules are the server rules.
    isPrimary
      ? Promise.resolve([])
      : database.getOwnInstanceRules({ domain: domain.domain }),
    database.getAnnouncements({ domain: domain.domain }),
    database.getAnnouncements({ domain: null }),
    database.getAdminReports({
      domain: domain.domain,
      resolved: false,
      limit: OPEN_REPORTS_LIMIT
    }),
    getResolvedServerSettings(database)
  ])

  const scope: DomainPageScope = {
    serverRules: serverRules.map(getAdminRule),
    ownRules: ownRules.map(getAdminRule),
    // Only what shows or is about to: no drafts, nothing past its end.
    announcements: announcements
      .filter((announcement) => isShowing(announcement, currentTime))
      .map(getAdminAnnouncement),
    // The all-domains ones showing now (published and started), which also
    // appear on this domain.
    allDomainsAnnouncements: everyDomainAnnouncements.filter(
      (announcement) =>
        computeAnnouncementStatus(
          {
            published: announcement.published,
            starts_at: announcement.startsAt,
            ends_at: announcement.endsAt
          },
          currentTime
        ).status === 'published'
    ).length,
    serverFeatures: settings.features,
    openReports: reports.length,
    openReportsCapped: reports.length >= OPEN_REPORTS_LIMIT,
    currentTime
  }

  return (
    <DomainSettings
      key={domain.domain}
      domain={domain}
      primaryDomain={getEnvDomains().primary}
      server={server}
      scope={scope}
    />
  )
}

export default Page

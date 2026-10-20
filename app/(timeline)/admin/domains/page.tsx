import Link from 'next/link'
import { redirect } from 'next/navigation'

import {
  PHONE_DETAIL_CLASS,
  SECONDARY_COLUMN_CLASS
} from '@/lib/components/admin/adminTable'
import {
  domainSettingsHref,
  getDomainSourceNote,
  getDomainStatusBadge,
  getSignupsBadge
} from '@/lib/components/admin/domains/domainLabels'
import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import {
  TABLE_CELL_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TableFrame
} from '@/lib/components/surface/TableFrame'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import type { AdminDomain } from '@/lib/services/domains/adminDomainTypes'
import { getAdminDomainList } from '@/lib/services/domains/adminDomains'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const HEAD_CELL_CLASS = 'px-3 py-2.5 font-medium'

const DomainAction = ({ domain }: { domain: AdminDomain }) => {
  if (domain.source === 'primary') {
    return (
      <Link
        href="/admin/instance"
        className="text-primary-text text-sm font-medium hover:underline"
        aria-label={`Open Instance settings for ${domain.domain}`}
      >
        Instance
      </Link>
    )
  }
  return (
    <Link
      href={domainSettingsHref(domain.domain)}
      className="text-primary-text text-sm font-medium hover:underline"
      aria-label={`Edit ${domain.domain}`}
    >
      Edit
    </Link>
  )
}

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const { domains, wildcards } = await getAdminDomainList(database)
  const hasEnvDomains = domains.some((domain) => domain.source !== 'database')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Domains"
        description="Domains this server answers on."
        actions={
          <Button asChild>
            <Link href="/admin/domains/new">Add domain</Link>
          </Button>
        }
      />

      {hasEnvDomains ? (
        <Alert
          tone="info"
          title="Domains from environment variables are always on."
        >
          Their sign-up settings can be changed here. To turn one off or remove
          it, change ACTIVITIES_HOST or ACTIVITIES_TRUSTED_HOSTS.
        </Alert>
      ) : null}

      <TableFrame aria-label="Domains" tableClassName="sm:min-w-[40rem]">
        <thead>
          <tr className={TABLE_HEAD_ROW_CLASS}>
            <th scope="col" className={HEAD_CELL_CLASS}>
              Domain
            </th>
            <th
              scope="col"
              className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
            >
              Name
            </th>
            <th
              scope="col"
              className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
            >
              Profiles
            </th>
            <th
              scope="col"
              className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
            >
              Sign-ups
            </th>
            <th
              scope="col"
              className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
            >
              Status
            </th>
            <th scope="col" className={`${HEAD_CELL_CLASS} text-right`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {domains.map((domain) => {
            const signups = getSignupsBadge(domain)
            const status = getDomainStatusBadge(domain)
            const note = getDomainSourceNote(domain)
            return (
              <tr key={domain.domain} className="align-top">
                <td className={`${TABLE_CELL_CLASS} sm:max-w-64`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-all">
                      {domain.domain}
                    </span>
                    {domain.source === 'primary' ? (
                      <Badge tone="primary">Primary</Badge>
                    ) : null}
                    {domain.source === 'env' ? (
                      <Badge tone="gray">Set in env</Badge>
                    ) : null}
                  </div>
                  {note ? (
                    <p className="text-muted-foreground mt-1 text-xs">{note}</p>
                  ) : null}
                  <div className={PHONE_DETAIL_CLASS}>
                    <span
                      className={
                        domain.name ? undefined : 'text-muted-foreground'
                      }
                    >
                      {domain.name ?? 'Same as server'}
                    </span>
                    <span>
                      {domain.profiles} profile
                      {domain.profiles === 1 ? '' : 's'}
                    </span>
                    <Badge tone={signups.tone}>{signups.label}</Badge>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                </td>
                <td className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}>
                  {domain.name ?? (
                    <span className="text-muted-foreground">
                      Same as server
                    </span>
                  )}
                </td>
                <td
                  className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS} tabular-nums`}
                >
                  {domain.profiles}
                </td>
                <td className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}>
                  <Badge tone={signups.tone} className="whitespace-nowrap">
                    {signups.label}
                  </Badge>
                </td>
                <td className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}>
                  <Badge tone={status.tone} className="whitespace-nowrap">
                    {status.label}
                  </Badge>
                </td>
                <td className={`${TABLE_CELL_CLASS} text-right`}>
                  <DomainAction domain={domain} />
                </td>
              </tr>
            )
          })}
          {wildcards.map((wildcard) => (
            <tr key={wildcard.rule}>
              <td colSpan={6} className={TABLE_CELL_CLASS}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-all">{wildcard.rule}</span>
                  <Badge tone="gray">Wildcard</Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Env rule in ACTIVITIES_TRUSTED_HOSTS. Matching hosts are
                  trusted for requests, but profiles and sign-ups need a domain
                  of their own in this list. Not editable here.
                </p>
              </td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </div>
  )
}

export default Page

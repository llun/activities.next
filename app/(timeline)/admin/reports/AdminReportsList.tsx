'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { getAdminReports } from '@/lib/client'
import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import {
  PHONE_DETAIL_CLASS,
  SECONDARY_COLUMN_CLASS
} from '@/lib/components/admin/adminTable'
import { RefreshButton } from '@/lib/components/refresh-button'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Frame } from '@/lib/components/surface/Frame'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { SkeletonRows } from '@/lib/components/surface/Skeleton'
import {
  TABLE_CELL_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TableFrame
} from '@/lib/components/surface/TableFrame'
import { Badge } from '@/lib/components/ui/badge'
import { AdminReport } from '@/lib/types/mastodon/admin/report'

const acct = (account: AdminReport['account']) =>
  account.domain ? `${account.username}@${account.domain}` : account.username

const HEAD_CELL_CLASS = 'px-3 py-2.5 font-medium'

const TABS = [
  { value: 'open', label: 'Unresolved' },
  { value: 'resolved', label: 'Resolved' }
]

const statusCount = (report: AdminReport) =>
  report.statuses.length > 0 ? (
    <span className="text-muted-foreground">
      {' '}
      · {report.statuses.length} status
      {report.statuses.length === 1 ? '' : 'es'}
    </span>
  ) : null

const formatCreated = (value: string | undefined) => {
  const time = value ? Date.parse(value) : NaN
  return Number.isNaN(time) ? '—' : new Date(time).toLocaleDateString()
}

export const AdminReportsList = () => {
  const [resolved, setResolved] = useState(false)
  const [reports, setReports] = useState<AdminReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReports(await getAdminReports(resolved))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [resolved])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Report status"
          size="sm"
          items={TABS}
          value={resolved ? 'resolved' : 'open'}
          onValueChange={(value) => setResolved(value === 'resolved')}
        />
        <RefreshButton
          accessibleName="Refresh reports"
          refreshing={loading}
          onRefresh={() => void load()}
        />
      </div>

      {loading ? (
        <Frame className="p-4">
          <SkeletonRows rows={4} rowClassName="h-10" label="Loading reports" />
        </Frame>
      ) : error ? (
        <Alert title={error} onRetry={() => void load()} />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={ADMIN_ICONS.reports}
          title={`No ${resolved ? 'resolved' : 'open'} reports.`}
        >
          {resolved
            ? 'Reports you resolve are kept here.'
            : 'Reports from people on this server and others show up here.'}
        </EmptyState>
      ) : (
        <TableFrame aria-label="Reports" tableClassName="sm:min-w-[40rem]">
          <thead>
            <tr className={TABLE_HEAD_ROW_CLASS}>
              <th scope="col" className={HEAD_CELL_CLASS}>
                Reporter
              </th>
              <th
                scope="col"
                className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
              >
                Target
              </th>
              <th
                scope="col"
                className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
              >
                Category
              </th>
              <th
                scope="col"
                className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
              >
                Status
              </th>
              <th
                scope="col"
                className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
              >
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {reports.map((report) => (
              <tr key={report.id} className="hover:bg-muted/60">
                <td className={`${TABLE_CELL_CLASS} sm:max-w-48`}>
                  <Link
                    href={`/admin/reports/${report.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {acct(report.account)}
                  </Link>
                  <div className={PHONE_DETAIL_CLASS}>
                    <span className="min-w-0 break-all">
                      Reported {acct(report.target_account)}
                    </span>
                    <span>
                      <span className="capitalize">{report.category}</span>
                      {statusCount(report)}
                    </span>
                    <Badge tone={report.action_taken ? 'gray' : 'primary'}>
                      {report.action_taken ? 'Resolved' : 'Open'}
                    </Badge>
                    <span>{formatCreated(report.created_at)}</span>
                  </div>
                </td>
                <td
                  className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS} max-w-48 truncate`}
                >
                  {acct(report.target_account)}
                </td>
                <td className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}>
                  <span className="capitalize">{report.category}</span>
                  {statusCount(report)}
                </td>
                <td className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}>
                  <Badge tone={report.action_taken ? 'gray' : 'primary'}>
                    {report.action_taken ? 'Resolved' : 'Open'}
                  </Badge>
                </td>
                <td
                  className={`${TABLE_CELL_CLASS} ${SECONDARY_COLUMN_CLASS} text-muted-foreground whitespace-nowrap`}
                >
                  {formatCreated(report.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import {
  type ReportCategory,
  assignAdminReportToSelf,
  getAdminReport,
  reopenAdminReport,
  resolveAdminReport,
  unassignAdminReport,
  updateAdminReport
} from '@/lib/client'
import { DetailList } from '@/lib/components/admin/DetailList'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Select } from '@/lib/components/ui/select'
import { AdminReport } from '@/lib/types/mastodon/admin/report'

const CATEGORIES: ReportCategory[] = ['spam', 'legal', 'violation', 'other']

const acct = (account: AdminReport['account']) =>
  account.domain ? `${account.username}@${account.domain}` : account.username

export const AdminReportDetail = ({ reportId }: { reportId: string }) => {
  const [report, setReport] = useState<AdminReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setReport(await getAdminReport(reportId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [reportId])

  useEffect(() => {
    load()
  }, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const retry = () => {
    setLoading(true)
    void load()
  }

  if (loading) {
    return (
      <SectionSkeleton title={false} sections={[5, 3]} label="Loading report" />
    )
  }
  if (!report) {
    return <Alert title={error ?? 'Report unavailable'} onRetry={retry} />
  }

  return (
    <div className="space-y-6">
      <Section title="Details">
        <DetailList
          items={[
            { label: 'Reporter', value: acct(report.account) },
            { label: 'Target', value: acct(report.target_account) },
            {
              label: 'Category',
              value: <span className="capitalize">{report.category}</span>
            },
            {
              label: 'Status',
              value: (
                <Badge tone={report.action_taken ? 'gray' : 'primary'}>
                  {report.action_taken ? 'Resolved' : 'Open'}
                </Badge>
              )
            },
            {
              label: 'Assigned to',
              value: report.assigned_account
                ? acct(report.assigned_account)
                : 'Unassigned'
            },
            ...(report.comment
              ? [
                  {
                    label: 'Comment',
                    value: (
                      <span className="font-normal whitespace-pre-wrap">
                        {report.comment}
                      </span>
                    )
                  }
                ]
              : [])
          ]}
        />
      </Section>

      {report.rules.length > 0 ? (
        <Section title="Broken rules" meta={report.rules.length}>
          <FramedList aria-label="Broken rules">
            {report.rules.map((rule) => (
              <FramedListItem key={rule.id} className="text-sm">
                {rule.text}
              </FramedListItem>
            ))}
          </FramedList>
        </Section>
      ) : null}

      {report.statuses.length > 0 ? (
        <Section title="Reported statuses" meta={report.statuses.length}>
          <FramedList aria-label="Reported statuses">
            {report.statuses.map((status) => (
              <FramedListItem key={status.id} className="truncate text-sm">
                <Link
                  href={status.url ?? '#'}
                  className="text-primary-text hover:underline"
                >
                  {status.url ?? status.id}
                </Link>
              </FramedListItem>
            ))}
          </FramedList>
        </Section>
      ) : null}

      <Section title="Moderation">
        <Frame divided>
          <FormRow label="Category" htmlFor="report-category">
            <Select
              id="report-category"
              value={report.category}
              disabled={busy}
              onChange={(event) =>
                run(() =>
                  updateAdminReport({
                    id: reportId,
                    category: event.target.value as ReportCategory
                  })
                )
              }
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </FormRow>

          <FormRow
            label="Assignment"
            hint={
              report.assigned_account
                ? `Assigned to ${acct(report.assigned_account)}.`
                : 'Nobody is handling this report yet.'
            }
          >
            {report.assigned_account ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => unassignAdminReport(reportId))}
              >
                Unassign
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => assignAdminReportToSelf(reportId))}
              >
                Assign to me
              </Button>
            )}
          </FormRow>

          <FormRow
            label="Resolution"
            hint={
              report.action_taken
                ? 'This report is resolved.'
                : 'Resolve it once you have dealt with it.'
            }
          >
            {report.action_taken ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => reopenAdminReport(reportId))}
              >
                Reopen
              </Button>
            ) : (
              <Button
                type="button"
                disabled={busy}
                onClick={() => run(() => resolveAdminReport(reportId))}
              >
                Resolve
              </Button>
            )}
          </FormRow>
        </Frame>
      </Section>

      {error ? <Alert title={error} /> : null}
    </div>
  )
}

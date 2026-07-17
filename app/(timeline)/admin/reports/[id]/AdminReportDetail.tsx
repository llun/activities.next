'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import {
  assignAdminReportToSelf,
  getAdminReport,
  reopenAdminReport,
  resolveAdminReport,
  unassignAdminReport,
  updateAdminReport
} from '@/lib/client'
import { ReportCategory } from '@/lib/client'
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

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading report…</p>
  }
  if (!report) {
    return (
      <p className="text-sm text-destructive">
        {error ?? 'Report unavailable'}
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-background/80 p-6 shadow-sm">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Reporter</dt>
            <dd className="font-medium">{acct(report.account)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Target</dt>
            <dd className="font-medium">{acct(report.target_account)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Category</dt>
            <dd className="font-medium">{report.category}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd className="font-medium">
              {report.action_taken ? 'Resolved' : 'Open'}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Assigned to</dt>
            <dd className="font-medium">
              {report.assigned_account
                ? acct(report.assigned_account)
                : 'Unassigned'}
            </dd>
          </div>
        </dl>
        {report.comment ? (
          <p className="mt-4 whitespace-pre-wrap text-sm">{report.comment}</p>
        ) : null}
      </div>

      {report.rules.length > 0 ? (
        <div className="rounded-2xl border bg-background/80 p-6 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Broken rules</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {report.rules.map((rule) => (
              <li key={rule.id}>{rule.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.statuses.length > 0 ? (
        <div className="rounded-2xl border bg-background/80 p-6 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">
            Reported statuses ({report.statuses.length})
          </h2>
          <ul className="space-y-2 text-sm">
            {report.statuses.map((status) => (
              <li key={status.id} className="truncate">
                <Link
                  href={status.url ?? '#'}
                  className="text-primary hover:underline"
                >
                  {status.url ?? status.id}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground">Category</label>
        <select
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
          className="rounded-lg border px-2 py-1.5 text-sm"
        >
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        {report.assigned_account ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => unassignAdminReport(reportId))}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Unassign
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => assignAdminReportToSelf(reportId))}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Assign to me
          </button>
        )}

        {report.action_taken ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => reopenAdminReport(reportId))}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Reopen
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => resolveAdminReport(reportId))}
            className="rounded-lg border border-primary/40 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            Resolve
          </button>
        )}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

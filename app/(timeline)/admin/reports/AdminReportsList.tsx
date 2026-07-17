'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { getAdminReports } from '@/lib/client'
import { AdminReport } from '@/lib/types/mastodon/admin/report'

const acct = (account: AdminReport['account']) =>
  account.domain ? `${account.username}@${account.domain}` : account.username

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
      <div className="inline-flex rounded-lg border p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setResolved(false)}
          className={`rounded-md px-3 py-1 font-medium transition-colors ${
            !resolved ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
          }`}
        >
          Unresolved
        </button>
        <button
          type="button"
          onClick={() => setResolved(true)}
          className={`rounded-md px-3 py-1 font-medium transition-colors ${
            resolved ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
          }`}
        >
          Resolved
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading reports…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : reports.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
          No {resolved ? 'resolved' : 'open'} reports.
        </div>
      ) : (
        <ul className="space-y-2">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                href={`/admin/reports/${report.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors hover:bg-muted"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {acct(report.account)} → {acct(report.target_account)}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {report.category}
                    {report.statuses.length > 0
                      ? ` · ${report.statuses.length} status${
                          report.statuses.length === 1 ? '' : 'es'
                        }`
                      : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    report.action_taken
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-primary/10 text-primary'
                  }`}
                >
                  {report.action_taken ? 'Resolved' : 'Open'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

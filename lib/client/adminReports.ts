import type { AdminReport } from '@/lib/types/mastodon/admin/report'

import type { ReportCategory } from './accounts'

export interface UpdateAdminReportParams {
  id: string
  category?: ReportCategory
  ruleIds?: string[]
}

export const getAdminReports = async (
  resolved?: boolean
): Promise<AdminReport[]> => {
  const params = new URLSearchParams()
  if (resolved !== undefined)
    params.set('resolved', resolved ? 'true' : 'false')
  const query = params.toString()
  const response = await fetch(
    `/api/v1/admin/reports${query ? `?${query}` : ''}`,
    { headers: { Accept: 'application/json' }, credentials: 'include' }
  )
  if (!response.ok) throw new Error('Failed to load admin reports')
  return (await response.json()) as AdminReport[]
}

export const getAdminReport = async (id: string): Promise<AdminReport> => {
  const response = await fetch(`/api/v1/admin/reports/${id}`, {
    headers: { Accept: 'application/json' },
    credentials: 'include'
  })
  if (!response.ok) throw new Error('Failed to load admin report')
  return (await response.json()) as AdminReport
}

export const updateAdminReport = async ({
  id,
  category,
  ruleIds
}: UpdateAdminReportParams): Promise<AdminReport> => {
  const response = await fetch(`/api/v1/admin/reports/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      ...(category ? { category } : {}),
      ...(ruleIds ? { rule_ids: ruleIds } : {})
    })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'Failed to update report')
  }
  return (await response.json()) as AdminReport
}

const adminReportAction =
  (action: string) =>
  async (id: string): Promise<AdminReport> => {
    const response = await fetch(`/api/v1/admin/reports/${id}/${action}`, {
      method: 'POST',
      credentials: 'include'
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error ?? `Failed to ${action} report`)
    }
    return (await response.json()) as AdminReport
  }

export const assignAdminReportToSelf = adminReportAction('assign_to_self')
export const unassignAdminReport = adminReportAction('unassign')
export const resolveAdminReport = adminReportAction('resolve')
export const reopenAdminReport = adminReportAction('reopen')

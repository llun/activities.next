import type { AdminAccount } from '@/lib/types/mastodon/admin/account'

export interface AdminAccountFilters {
  origin?: 'local' | 'remote'
  status?: 'active' | 'pending' | 'disabled' | 'silenced' | 'suspended'
  username?: string
  byDomain?: string
}

export const getAdminAccounts = async (
  filters: AdminAccountFilters = {}
): Promise<AdminAccount[]> => {
  const params = new URLSearchParams()
  if (filters.origin) params.set('origin', filters.origin)
  if (filters.status) params.set('status', filters.status)
  if (filters.username) params.set('username', filters.username)
  if (filters.byDomain) params.set('by_domain', filters.byDomain)
  const query = params.toString()
  const response = await fetch(
    `/api/v2/admin/accounts${query ? `?${query}` : ''}`,
    { headers: { Accept: 'application/json' }, credentials: 'include' }
  )
  if (!response.ok) throw new Error('Failed to load admin accounts')
  return (await response.json()) as AdminAccount[]
}

export const getAdminAccount = async (id: string): Promise<AdminAccount> => {
  const response = await fetch(`/api/v1/admin/accounts/${id}`, {
    headers: { Accept: 'application/json' },
    credentials: 'include'
  })
  if (!response.ok) throw new Error('Failed to load admin account')
  return (await response.json()) as AdminAccount
}

export type AdminAccountActionType =
  'none' | 'disable' | 'sensitive' | 'silence' | 'suspend'

export interface PerformAdminAccountActionParams {
  id: string
  type: AdminAccountActionType
  reportId?: string
  text?: string
}

export const performAdminAccountAction = async ({
  id,
  type,
  reportId,
  text
}: PerformAdminAccountActionParams): Promise<void> => {
  const response = await fetch(`/api/v1/admin/accounts/${id}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      type,
      ...(reportId ? { report_id: reportId } : {}),
      ...(text ? { text } : {})
    })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'Failed to perform account action')
  }
}

const adminAccountStateChange =
  (action: string) =>
  async (id: string): Promise<AdminAccount> => {
    const response = await fetch(`/api/v1/admin/accounts/${id}/${action}`, {
      method: 'POST',
      credentials: 'include'
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error ?? `Failed to ${action} account`)
    }
    return (await response.json()) as AdminAccount
  }

export const adminEnableAccount = adminAccountStateChange('enable')
export const adminUnsilenceAccount = adminAccountStateChange('unsilence')
export const adminUnsuspendAccount = adminAccountStateChange('unsuspend')
export const adminUnsensitiveAccount = adminAccountStateChange('unsensitive')
export const adminApproveAccount = adminAccountStateChange('approve')
export const adminRejectAccount = adminAccountStateChange('reject')

export const adminDeleteAccount = async (id: string): Promise<AdminAccount> => {
  const response = await fetch(`/api/v1/admin/accounts/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'Failed to delete account')
  }
  return (await response.json()) as AdminAccount
}

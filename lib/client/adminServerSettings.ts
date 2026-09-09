import type { ResolvedServerSettings } from '@/lib/config/serverSettings'

// Database-backed admin server settings. Resolved values plus per-field lock
// metadata (env-pinned fields are locked and reject writes).
export interface AdminServerSettingsResponse {
  settings: ResolvedServerSettings
  locks: Record<string, { locked: boolean; envVar?: string }>
}

export const getAdminServerSettings =
  async (): Promise<AdminServerSettingsResponse> => {
    const response = await fetch('/api/v1/admin/server_settings', {
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) throw new Error('Failed to load server settings')
    return (await response.json()) as AdminServerSettingsResponse
  }

// Partial { key: value } patch. Env-locked, unknown, or invalid keys are
// rejected server-side and nothing is written; the thrown message surfaces to
// the form.
export const updateAdminServerSettings = async (
  patch: Record<string, unknown>
): Promise<AdminServerSettingsResponse> => {
  const response = await fetch('/api/v1/admin/server_settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'Failed to save server settings')
  }
  return (await response.json()) as AdminServerSettingsResponse
}

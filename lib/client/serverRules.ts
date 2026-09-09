import type { AdminRule } from '@/lib/services/rules/adminRule'

export type ServerRule = AdminRule

export interface ServerRuleInput {
  text: string
  hint: string
  position?: number
}

export const getServerRules = async (): Promise<ServerRule[]> => {
  const response = await fetch('/api/v2/admin/rules', {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  // Throw (rather than returning []) so an HTTP error is surfaced by the
  // caller's error handling instead of being indistinguishable from an
  // empty list. Mirrors the throwing pattern used by getServerFilters().
  if (!response.ok) {
    throw new Error(`Failed to load rules (${response.status})`)
  }
  return (await response.json()) as ServerRule[]
}

export const createServerRule = async (
  input: ServerRuleInput
): Promise<ServerRule | null> => {
  const response = await fetch('/api/v2/admin/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!response.ok) return null
  return (await response.json()) as ServerRule
}

export const updateServerRule = async (
  id: string,
  input: Partial<ServerRuleInput>
): Promise<ServerRule | null> => {
  const response = await fetch(
    `/api/v2/admin/rules/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }
  )
  if (!response.ok) return null
  return (await response.json()) as ServerRule
}

export const deleteServerRule = async (id: string): Promise<boolean> => {
  const response = await fetch(
    `/api/v2/admin/rules/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  )
  return response.ok
}

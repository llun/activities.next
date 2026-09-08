import type { AdminAnnouncement } from '@/lib/services/announcements/adminAnnouncement'

export type ServerAnnouncement = AdminAnnouncement

export interface ServerAnnouncementInput {
  text: string
  starts_at?: string | null
  ends_at?: string | null
  all_day?: boolean
  published?: boolean
}

export const getServerAnnouncements = async (): Promise<
  ServerAnnouncement[]
> => {
  const response = await fetch('/api/v2/admin/announcements', {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  // Throw (rather than returning []) so an HTTP error is surfaced by the
  // caller's error handling instead of being indistinguishable from an empty
  // list. Mirrors the throwing pattern used by getServerRules().
  if (!response.ok) {
    throw new Error(`Failed to load announcements (${response.status})`)
  }
  return (await response.json()) as ServerAnnouncement[]
}

export const createServerAnnouncement = async (
  input: ServerAnnouncementInput
): Promise<ServerAnnouncement | null> => {
  const response = await fetch('/api/v2/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!response.ok) return null
  return (await response.json()) as ServerAnnouncement
}

export const updateServerAnnouncement = async (
  id: string,
  input: Partial<ServerAnnouncementInput>
): Promise<ServerAnnouncement | null> => {
  const response = await fetch(
    `/api/v2/admin/announcements/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }
  )
  if (!response.ok) return null
  return (await response.json()) as ServerAnnouncement
}

export const deleteServerAnnouncement = async (
  id: string
): Promise<boolean> => {
  const response = await fetch(
    `/api/v2/admin/announcements/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  )
  return response.ok
}

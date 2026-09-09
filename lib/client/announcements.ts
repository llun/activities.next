import type { Announcement } from '@/lib/types/mastodon/announcement'

// Public announcements (https://docs.joinmastodon.org/methods/announcements/).
// The active server announcements shown to a signed-in user, each carrying a
// per-actor `read` flag. Distinct from the admin `getServerAnnouncements`
// management list — these render published content for the timeline banner.

// Returns the active announcements for the current actor. Returns [] on a
// non-OK response so the timeline banner degrades to showing nothing rather
// than surfacing an error to the reader.
export const getAnnouncements = async (): Promise<Announcement[]> => {
  const response = await fetch('/api/v1/announcements', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) return []
  return (await response.json()) as Announcement[]
}

/**
 * Dismisses (marks as read) a single announcement for the current actor using
 * the Mastodon-compatible announcements API.
 * @see https://docs.joinmastodon.org/methods/announcements/#dismiss
 */
export const dismissAnnouncement = async (id: string): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/announcements/${encodeURIComponent(id)}/dismiss`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.ok
}

/**
 * Adds the current actor's reaction (unicode emoji or custom-emoji shortcode)
 * to an announcement. Returns true on success. Mirrors `dismissAnnouncement`'s
 * boolean-ok style so the banner can fall back to its optimistic state.
 * @see https://docs.joinmastodon.org/methods/announcements/#put-reactions
 */
export const addAnnouncementReaction = async (
  id: string,
  name: string
): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/announcements/${encodeURIComponent(id)}/reactions/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.ok
}

/**
 * Removes the current actor's reaction from an announcement. Returns true on
 * success.
 * @see https://docs.joinmastodon.org/methods/announcements/#delete-reactions
 */
export const removeAnnouncementReaction = async (
  id: string,
  name: string
): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/announcements/${encodeURIComponent(id)}/reactions/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.ok
}

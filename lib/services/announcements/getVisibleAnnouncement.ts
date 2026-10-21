import { AnnouncementData } from '@/lib/database/domains/announcement/types'
import { Database } from '@/lib/database/types'
import { getAnnouncementsDomainForHost } from '@/lib/services/domains/domainAudience'
import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'

/**
 * The announcement `id` when it is published and shown on the visited host
 * (for every domain, or for the domain `host` resolves to) — the same audience
 * as GET /api/v1/announcements — otherwise null. Mastodon answers 404 for
 * these too (`Announcement.published.find`).
 */
export const getVisibleAnnouncement = async (
  database: Database,
  host: string | null | undefined,
  id: string
): Promise<AnnouncementData | null> => {
  const announcement = await database.getAnnouncement({ id })
  if (!announcement || !announcement.published) return null
  if (announcement.domain === null) return announcement
  await ensureServedDomainsFresh()
  const domain = await getAnnouncementsDomainForHost(database, host)
  return announcement.domain === domain ? announcement : null
}

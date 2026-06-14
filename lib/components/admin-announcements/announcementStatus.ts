import type { ServerAnnouncement } from '@/lib/client'

export type AnnouncementStatus = 'published' | 'scheduled' | 'draft' | 'expired'

export interface AnnouncementStatusDescriptor {
  status: AnnouncementStatus
  label: string
  tone: 'green' | 'orange' | 'gray'
}

const DESCRIPTORS: Record<AnnouncementStatus, AnnouncementStatusDescriptor> = {
  published: { status: 'published', label: 'Published', tone: 'green' },
  scheduled: { status: 'scheduled', label: 'Scheduled', tone: 'orange' },
  draft: { status: 'draft', label: 'Draft', tone: 'gray' },
  expired: { status: 'expired', label: 'Expired', tone: 'gray' }
}

// Derives the lifecycle status of an announcement from its existing fields
// relative to `currentTime` (epoch-ms). No backend support is required:
// - not published                              -> Draft
// - published, with an end time in the past    -> Expired
// - published, with a future event start time  -> Scheduled
// - published, otherwise (active)              -> Published
//
// The "Scheduled" state matches getActiveAnnouncements' start-window filter
// (`startsAt IS NULL OR startsAt <= now` in lib/database/sql/announcement.ts):
// a published announcement whose `starts_at` is still in the future is hidden
// from the public banner, so the admin badge must not read "Published" for it.
//
// A future *publish-at* (as opposed to event start) state is intentionally not
// modeled: the backend stamps `published_at` only when an announcement is
// published (publishedAt = published ? currentTime : null in lib/database/sql),
// so an unpublished announcement always has `published_at === null` and the
// admin form exposes no publish-at input. Re-add it when scheduled publishing
// ships.
export const computeAnnouncementStatus = (
  announcement: Pick<ServerAnnouncement, 'published' | 'starts_at' | 'ends_at'>,
  currentTime: number
): AnnouncementStatusDescriptor => {
  if (!announcement.published) {
    return DESCRIPTORS.draft
  }
  if (announcement.ends_at !== null && announcement.ends_at < currentTime) {
    return DESCRIPTORS.expired
  }
  if (announcement.starts_at !== null && announcement.starts_at > currentTime) {
    return DESCRIPTORS.scheduled
  }
  return DESCRIPTORS.published
}

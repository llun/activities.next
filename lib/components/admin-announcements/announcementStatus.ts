import type { ServerAnnouncement } from '@/lib/client'

export type AnnouncementStatus = 'published' | 'draft' | 'expired'

export interface AnnouncementStatusDescriptor {
  status: AnnouncementStatus
  label: string
  tone: 'green' | 'orange' | 'gray'
}

const DESCRIPTORS: Record<AnnouncementStatus, AnnouncementStatusDescriptor> = {
  published: { status: 'published', label: 'Published', tone: 'green' },
  draft: { status: 'draft', label: 'Draft', tone: 'gray' },
  expired: { status: 'expired', label: 'Expired', tone: 'gray' }
}

// Derives the lifecycle status of an announcement from its existing fields
// relative to `currentTime` (epoch-ms). No backend support is required:
// - not published                          -> Draft
// - published, with an end time in the past -> Expired
// - published, otherwise (active)           -> Published
//
// A "Scheduled" (future publish-at) state is intentionally not modeled: the
// backend stamps `published_at` only when an announcement is published
// (publishedAt = published ? currentTime : null in lib/database/sql), so an
// unpublished announcement always has `published_at === null` and the admin
// form exposes no publish-at input. Re-add it when scheduled publishing ships.
export const computeAnnouncementStatus = (
  announcement: Pick<ServerAnnouncement, 'published' | 'ends_at'>,
  currentTime: number
): AnnouncementStatusDescriptor => {
  if (!announcement.published) {
    return DESCRIPTORS.draft
  }
  if (announcement.ends_at !== null && announcement.ends_at < currentTime) {
    return DESCRIPTORS.expired
  }
  return DESCRIPTORS.published
}

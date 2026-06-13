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
// - not published, with a future publish time -> Scheduled
// - not published, otherwise                   -> Draft
// - published, with an end time in the past    -> Expired
// - published, otherwise (active)              -> Published
export const computeAnnouncementStatus = (
  announcement: Pick<
    ServerAnnouncement,
    'published' | 'published_at' | 'ends_at'
  >,
  currentTime: number
): AnnouncementStatusDescriptor => {
  if (!announcement.published) {
    if (
      announcement.published_at !== null &&
      announcement.published_at > currentTime
    ) {
      return DESCRIPTORS.scheduled
    }
    return DESCRIPTORS.draft
  }
  if (announcement.ends_at !== null && announcement.ends_at < currentTime) {
    return DESCRIPTORS.expired
  }
  return DESCRIPTORS.published
}

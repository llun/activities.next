import { z } from 'zod'

import { AnnouncementData } from '@/lib/types/database/operations'

// Body validation for the admin announcements endpoints. `text` is stored in an
// unbounded `text` column, so the 5000 cap is a product limit that keeps
// announcements readable rather than a database constraint. `starts_at`/
// `ends_at` are ISO-8601 datetimes (or null to clear the bound); `all_day` and
// `published` are coerced booleans so form submissions of "true"/"false" or
// "on" still validate.
export const AnnouncementCreateInput = z.object({
  text: z.string().trim().min(1).max(5000),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at: z.string().datetime().optional().nullable(),
  all_day: z.coerce.boolean().optional(),
  published: z.coerce.boolean().optional()
})

// Partial update — every field is optional, but present fields must satisfy the
// same constraints as creation. At least one field must be present so an empty
// body is rejected with 422 rather than performing a timestamp-only no-op
// update.
export const AnnouncementUpdateInput = z
  .object({
    text: z.string().trim().min(1).max(5000).optional(),
    starts_at: z.string().datetime().optional().nullable(),
    ends_at: z.string().datetime().optional().nullable(),
    all_day: z.coerce.boolean().optional(),
    published: z.coerce.boolean().optional()
  })
  .refine(
    (data) =>
      data.text !== undefined ||
      data.starts_at !== undefined ||
      data.ends_at !== undefined ||
      data.all_day !== undefined ||
      data.published !== undefined,
    {
      message:
        'At least one of text, starts_at, ends_at, all_day, or published must be provided'
    }
  )

// Maps an optional ISO-8601 string (or null) to the epoch-ms storage form the
// announcement database mixin expects. `undefined` stays `undefined` so a
// partial update leaves the bound untouched.
export const isoToStorageTime = (
  value: string | null | undefined
): number | null | undefined => {
  if (value === undefined) return undefined
  if (value === null) return null
  return Date.parse(value)
}

// Admin shape — the raw announcement fields the management panel edits,
// including the storage-form timestamps and publish state. Distinct from the
// public Mastodon Announcement entity, which renders content to HTML and hides
// the unpublished/draft fields.
export const getAdminAnnouncement = (announcement: AnnouncementData) => ({
  id: announcement.id,
  text: announcement.text,
  published: announcement.published,
  all_day: announcement.allDay,
  starts_at: announcement.startsAt,
  ends_at: announcement.endsAt,
  published_at: announcement.publishedAt,
  created_at: announcement.createdAt,
  updated_at: announcement.updatedAt
})
export type AdminAnnouncement = ReturnType<typeof getAdminAnnouncement>

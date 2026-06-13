import { z } from 'zod'

import { CustomEmoji } from '@/lib/types/mastodon/customEmoji'

export const AnnouncementReaction = z.object({
  name: z.string(),
  count: z.number(),
  me: z.boolean(),
  url: z.string().nullable().optional(),
  static_url: z.string().nullable().optional()
})
export type AnnouncementReaction = z.infer<typeof AnnouncementReaction>

export const Announcement = z.object({
  id: z.string(),
  content: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  all_day: z.boolean(),
  published_at: z.string(),
  updated_at: z.string(),
  read: z.boolean().optional(),
  mentions: z.unknown().array(),
  statuses: z.unknown().array(),
  tags: z.unknown().array(),
  emojis: CustomEmoji.array(),
  reactions: AnnouncementReaction.array()
})
export type Announcement = z.infer<typeof Announcement>

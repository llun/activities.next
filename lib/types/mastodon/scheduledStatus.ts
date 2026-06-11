import { z } from 'zod'

import { MediaAttachment } from '@/lib/types/mastodon/mediaAttachment'

export const ScheduledStatusParams = z.object({
  text: z.string(),
  poll: z
    .object({
      options: z.string().array(),
      expires_in: z.number(),
      multiple: z.boolean(),
      hide_totals: z.boolean()
    })
    .nullable(),
  media_ids: z.string().array().nullable(),
  sensitive: z.boolean().nullable(),
  spoiler_text: z.string().nullable(),
  visibility: z.enum(['public', 'unlisted', 'private', 'direct']),
  in_reply_to_id: z.string().nullable(),
  language: z.string().nullable(),
  application_id: z.string().nullable(),
  scheduled_at: z.string().nullable(),
  idempotency: z.string().nullable(),
  with_rate_limit: z.boolean()
})
export type ScheduledStatusParams = z.infer<typeof ScheduledStatusParams>

export const ScheduledStatus = z.object({
  id: z.string(),
  scheduled_at: z.string(),
  params: ScheduledStatusParams,
  media_attachments: MediaAttachment.array()
})
export type ScheduledStatus = z.infer<typeof ScheduledStatus>

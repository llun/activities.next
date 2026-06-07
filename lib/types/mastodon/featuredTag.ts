// This schema is based on https://docs.joinmastodon.org/entities/FeaturedTag/
import { z } from 'zod'

export const FeaturedTag = z.object({
  id: z
    .string()
    .describe('The internal ID of the featured tag in the database'),
  name: z.string().describe('The name of the hashtag being featured'),
  url: z
    .string()
    .describe(
      'A link to all statuses by the account that contain this hashtag'
    ),
  statuses_count: z
    .string()
    .describe('The number of authored statuses containing this hashtag'),
  last_status_at: z
    .string()
    .nullable()
    .describe('The date of the last authored status containing this hashtag')
})
export type FeaturedTag = z.infer<typeof FeaturedTag>

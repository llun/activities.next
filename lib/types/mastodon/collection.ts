// Mastodon 4.6 Collection entity (profiles-only projection).
// Based on the Collections API introduced in Mastodon 4.6.
import { z } from 'zod'

export const CollectionEntity = z.object({
  id: z.string().describe('The internal database ID of the collection'),
  title: z.string().describe('The user-defined title of the collection'),
  description: z
    .string()
    .nullable()
    .describe('A longer description of the collection'),
  topic: z
    .string()
    .nullable()
    .describe('A single hashtag (without #) categorising the collection'),
  language: z
    .string()
    .nullable()
    .describe('The primary language of the collection (ISO 639)'),
  visibility: z
    .enum(['public', 'unlisted', 'private'])
    .describe('Who can see the collection'),
  // activities.next extension over the upstream Mastodon entity.
  feed_enabled: z
    .boolean()
    .describe('Whether the collection is exposed as a shareable feed'),
  size: z
    .number()
    .describe('Number of approved (publicly visible) members in the collection')
})
export type CollectionEntity = z.infer<typeof CollectionEntity>

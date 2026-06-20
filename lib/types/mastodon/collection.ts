// Mastodon 4.6 Collection entity (profiles-only projection).
// Based on the Collections API introduced in Mastodon 4.6.
import { z } from 'zod'

// Input validation for the collection "topic" — a single hashtag stored without
// the leading '#'. Uses the unicode-aware hashtag charset (letters, numbers,
// underscore) so international hashtags are accepted, while rejecting '#',
// whitespace, and punctuation. `null` clears the topic.
export const CollectionTopicInput = z
  .string()
  .trim()
  .max(255)
  .regex(
    /^[\p{L}\p{N}_]+$/u,
    'topic must be a single hashtag without "#", spaces, or punctuation'
  )
  .nullable()
  .optional()

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

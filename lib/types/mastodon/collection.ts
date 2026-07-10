// Mastodon 4.6 Collection entity (profiles-only projection).
// Based on the Collections API introduced in Mastodon 4.6.
import { z } from 'zod'

import { Mastodon } from '@/lib/types/activitypub'

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

// --- Final Mastodon 4.6 entities -------------------------------------------
// The merged wire entity below is the legacy CollectionEntity (kept for the
// first-party UI) extended with the final 4.6 spec fields, so API consumers of
// either vocabulary read one object.

// Spec CollectionItem.state. Internal consent states map as pending → pending,
// approved → accepted, revoked → revoked. `rejected` exists for parse
// compatibility but is never emitted: declining a pending request is stored as
// 'revoked' by the consent model.
export const CollectionItemState = z.enum([
  'pending',
  'accepted',
  'rejected',
  'revoked'
])
export type CollectionItemState = z.infer<typeof CollectionItemState>

export const CollectionItemEntity = z.object({
  id: z
    .string()
    .describe('Stable id of the membership row (collection_members.id)'),
  account_id: z
    .string()
    .describe('Mastodon Account id of the featured account'),
  state: CollectionItemState,
  created_at: z.string().describe('When the item was added to the collection')
})
export type CollectionItemEntity = z.infer<typeof CollectionItemEntity>

export const CollectionTag = z.object({
  name: z.string(),
  url: z.string()
})
export type CollectionTag = z.infer<typeof CollectionTag>

export const MastodonCollectionEntity = CollectionEntity.extend({
  account_id: z.string().describe('Mastodon Account id of the curator'),
  uri: z
    .string()
    .describe('ActivityPub identifier (FEP-7aa9 FeaturedCollection)'),
  url: z.string().nullable().describe('HTML page of the collection'),
  name: z.string().describe('Spec alias of title'),
  // Spec type is a plain (possibly empty) string — the legacy nullable
  // description is emitted as '' when unset.
  description: z.string(),
  local: z.boolean(),
  sensitive: z.boolean(),
  discoverable: z
    .boolean()
    .describe('True when visibility is public (profile/search surfaced)'),
  tag: CollectionTag.nullable(),
  item_count: z.number(),
  items: CollectionItemEntity.array(),
  created_at: z.string(),
  updated_at: z.string()
})
export type MastodonCollectionEntity = z.infer<typeof MastodonCollectionEntity>

export const WrappedCollection = z.object({
  collection: MastodonCollectionEntity
})
export type WrappedCollection = z.infer<typeof WrappedCollection>

export const WrappedCollectionItem = z.object({
  collection_item: CollectionItemEntity
})
export type WrappedCollectionItem = z.infer<typeof WrappedCollectionItem>

export type CollectionWithAccounts = {
  accounts: Mastodon.Account[]
  collection: MastodonCollectionEntity
}

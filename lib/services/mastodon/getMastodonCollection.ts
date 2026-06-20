import { Collection } from '@/lib/types/domain/collection'
import { CollectionEntity } from '@/lib/types/mastodon/collection'

// Converts the internal Collection domain model into the Mastodon Collection
// entity (the profiles-only projection). `size` is the number of approved
// members — the count exposed to the public — and is resolved separately by the
// storage layer, so it is passed in rather than read from the Collection row.
export const getMastodonCollection = (
  collection: Collection,
  size: number
): CollectionEntity => ({
  id: collection.id,
  title: collection.title,
  description: collection.description,
  topic: collection.topic,
  language: collection.language,
  visibility: collection.visibility,
  feed_enabled: collection.publicFeed,
  size
})

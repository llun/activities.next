import { Database } from '@/lib/database/types'
import { CollectionItemRow } from '@/lib/types/database/operations'
import {
  Collection,
  CollectionFeatureState
} from '@/lib/types/domain/collection'
import {
  CollectionItemEntity,
  CollectionItemState,
  MastodonCollectionEntity,
  WrappedCollection,
  WrappedCollectionItem
} from '@/lib/types/mastodon/collection'
import { getLocalFeaturedCollectionId } from '@/lib/utils/activitypubId'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

// Consent-state → Mastodon 4.6 CollectionItem.state. The internal model has no
// 'rejected': a member declining a pending request is stored as 'revoked', so
// 'rejected' is never emitted.
const ITEM_STATE: Record<CollectionFeatureState, CollectionItemState> = {
  pending: 'pending',
  approved: 'accepted',
  revoked: 'revoked'
}

// Cap the inline `items` preview embedded in Collection entities; clients page
// the full membership through the items endpoint.
export const COLLECTION_ITEMS_PREVIEW_LIMIT = 40

export const serializeCollectionItem = (
  row: CollectionItemRow
): CollectionItemEntity => ({
  id: row.id,
  account_id: urlToId(row.targetActorId),
  state: ITEM_STATE[row.featureState],
  created_at: getISOTimeUTC(row.createdAt)
})

// Build the merged wire entity: the final Mastodon 4.6 Collection fields plus
// the activities.next extension vocabulary (title/topic/visibility/
// feed_enabled/size) the first-party UI consumes. `items` must already be
// filtered to the viewer's projection (owner: all states; public: approved
// only); `itemCount` counts the same projection and `approvedCount` is always
// the approved (publicly visible) member count.
export const serializeCollection = ({
  collection,
  items,
  itemCount,
  approvedCount
}: {
  collection: Collection
  items: CollectionItemRow[]
  itemCount: number
  approvedCount: number
}): MastodonCollectionEntity => {
  const host = new URL(collection.ownerActorId).host
  return {
    id: collection.id,
    account_id: urlToId(collection.ownerActorId),
    uri: getLocalFeaturedCollectionId(collection.ownerActorId, collection.id),
    url: `https://${host}/collections/${collection.id}`,
    name: collection.title,
    description: collection.description ?? '',
    language: collection.language,
    local: true,
    sensitive: collection.sensitive,
    discoverable: collection.visibility === 'public',
    tag: collection.topic
      ? {
          name: collection.topic,
          url: `https://${host}/tags/${encodeURIComponent(
            collection.topic.toLowerCase()
          )}`
        }
      : null,
    item_count: itemCount,
    items: items
      .slice(0, COLLECTION_ITEMS_PREVIEW_LIMIT)
      .map(serializeCollectionItem),
    created_at: getISOTimeUTC(collection.createdAt),
    updated_at: getISOTimeUTC(collection.updatedAt),
    title: collection.title,
    topic: collection.topic,
    visibility: collection.visibility,
    feed_enabled: collection.publicFeed,
    size: approvedCount
  }
}

export const wrapCollection = (
  collection: MastodonCollectionEntity
): WrappedCollection => ({ collection })

export const wrapCollectionItem = (
  item: CollectionItemEntity
): WrappedCollectionItem => ({ collection_item: item })

// Batch-serialize collections for a viewer projection. 'owner' embeds every
// item (any consent state) and counts all members; 'public' embeds only
// approved items and counts, so pending/revoked memberships never leak to
// non-owners. `size` stays the approved count in both projections (legacy
// contract).
export const getCollectionEntities = async (
  database: Database,
  collections: Collection[],
  projection: 'owner' | 'public'
): Promise<MastodonCollectionEntity[]> => {
  if (collections.length === 0) return []
  const collectionIds = collections.map((collection) => collection.id)
  const approvedOnly = projection === 'public'
  const [itemsMap, totalCounts, approvedCounts] = await Promise.all([
    database.getCollectionItems({ collectionIds, approvedOnly }),
    database.countCollectionItems({ collectionIds }),
    database.countCollectionItems({ collectionIds, approvedOnly: true })
  ])
  return collections.map((collection) =>
    serializeCollection({
      collection,
      items: itemsMap[collection.id] ?? [],
      itemCount: approvedOnly
        ? (approvedCounts[collection.id] ?? 0)
        : (totalCounts[collection.id] ?? 0),
      approvedCount: approvedCounts[collection.id] ?? 0
    })
  )
}

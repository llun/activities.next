import { Database } from '@/lib/database/types'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { CollectionItemRow } from '@/lib/types/database/operations'

// Resolve the `item_id` path segment of the item-scoped collection routes.
// Mastodon 4.6 addresses memberships by CollectionItem id; the pre-final
// activities.next API addressed them by the member's Account id and the
// first-party UI still does. Try the item id first (spec), then fall back to
// treating the segment as an Account id (extension, now resolved via
// resolveActorIdParam so it also accepts a UUIDv7 publicId). The two id
// spaces still cannot collide: collection-item row ids are v4 UUIDs (minted
// by randomUUID) while account publicIds are v7 — isPublicId (inside
// resolveActorIdParam) matches only the v7 shape, so a v4 item id is never
// mistaken for an actor publicId. A legacy urlToId-encoded account id
// (':'-delimited or 'apurl_'-prefixed) still can't collide with a v4 UUID
// either, same as before.
export const resolveCollectionItem = async (
  database: Database,
  collectionId: string,
  itemIdOrAccountId: string
): Promise<CollectionItemRow | null> => {
  const byItemId = await database.getCollectionItem({
    collectionId,
    itemId: itemIdOrAccountId
  })
  if (byItemId) return byItemId
  const targetActorId = await resolveActorIdParam(database, itemIdOrAccountId)
  if (!targetActorId) return null
  return database.getCollectionItemByAccount({ collectionId, targetActorId })
}

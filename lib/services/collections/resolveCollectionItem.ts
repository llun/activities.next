import { Database } from '@/lib/database/types'
import { CollectionItemRow } from '@/lib/types/database/operations'
import { idToUrl } from '@/lib/utils/urlToId'

// Resolve the `item_id` path segment of the item-scoped collection routes.
// Mastodon 4.6 addresses memberships by CollectionItem id; the pre-final
// activities.next API addressed them by the member's Account id and the
// first-party UI still does. Try the item id first (spec), then fall back to
// treating the segment as an Account id (extension). Item ids are UUIDs and
// account ids are urlToId-encoded (they contain ':' or the 'apurl_' prefix),
// so the namespaces cannot collide.
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
  const targetActorId = idToUrl(itemIdOrAccountId)
  if (!targetActorId) return null
  return database.getCollectionItemByAccount({ collectionId, targetActorId })
}

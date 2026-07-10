import { randomUUID } from 'crypto'

import { Database } from '@/lib/database/types'
import { INGEST_COLLECTION_MEMBER_JOB_NAME } from '@/lib/jobs/names'
import { notifyAddedToCollection } from '@/lib/services/notifications/collectionNotifications'
import { getQueue } from '@/lib/services/queue'
import { logger } from '@/lib/utils/logger'
import { idToUrl } from '@/lib/utils/urlToId'

// Cap the per-request batch of account ids to bound worst-case DB load on a
// single add/remove (collections are curated; clients can page large changes).
export const MAX_COLLECTION_ACCOUNT_IDS = 100

// Add members to an owned collection with the standard side effects: notify
// the newly-added local members (added_to_collection) and enqueue remote-member
// ingestion (instance actor follows + backfills their recent posts) out of
// band so federation never blocks the response. Extracted from the items route
// so collection create (spec `account_ids`) shares the same path. Notification
// failures are best-effort and must not fail the membership change; member ids
// are stored actor URLs (built via idToUrl), so `new URL` is safe.
export const addMembersToCollection = async ({
  database,
  collectionId,
  ownerActorId,
  accountIds
}: {
  database: Database
  collectionId: string
  ownerActorId: string
  accountIds: string[]
}): Promise<void> => {
  const addedActorIds = await database.addCollectionMembers({
    id: collectionId,
    actorId: ownerActorId,
    targetActorIds: accountIds.map((accountId) => idToUrl(accountId))
  })
  await notifyAddedToCollection(database, {
    collectionId,
    ownerActorId,
    addedActorIds
  }).catch(() => {})
  const ownerHost = new URL(ownerActorId).host
  const remoteMemberActorIds = [...new Set(addedActorIds)].filter(
    (memberActorId) => new URL(memberActorId).host !== ownerHost
  )
  for (const memberActorId of remoteMemberActorIds) {
    getQueue()
      .publish({
        id: randomUUID(),
        name: INGEST_COLLECTION_MEMBER_JOB_NAME,
        data: { memberActorId }
      })
      .catch((error) => {
        logger.warn({
          message: 'Failed to queue collection member ingestion',
          collectionId,
          memberActorId,
          error
        })
      })
  }
}

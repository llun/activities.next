import { randomUUID } from 'crypto'

import { Database } from '@/lib/database/types'
import { INGEST_COLLECTION_MEMBER_JOB_NAME } from '@/lib/jobs/names'
import { resolveActorIdParams } from '@/lib/services/mastodon/resolveClientId'
import { notifyAddedToCollection } from '@/lib/services/notifications/collectionNotifications'
import { getQueue } from '@/lib/services/queue'
import { logger } from '@/lib/utils/logger'

// Cap the per-request batch of account ids to bound worst-case DB load on a
// single add/remove (collections are curated; clients can page large changes).
export const MAX_COLLECTION_ACCOUNT_IDS = 100

// Membership rows store an actor's AP URI, so every resolved id has to be one.
// `resolveActorIdParams` returns an unknown publicId UNCHANGED (its documented
// "matches nothing" contract), and `idToUrl` is permissive enough to emit an
// unparseable string, so the resolved list can contain values that are not
// URIs at all.
const isActorUri = (value: string): boolean => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

// Add members to an owned collection with the standard side effects: notify
// the newly-added local members (added_to_collection) and enqueue remote-member
// ingestion (instance actor follows + backfills their recent posts) out of
// band so federation never blocks the response. Extracted from the items route
// so collection create (spec `account_ids`) shares the same path. Notification
// failures are best-effort and must not fail the membership change; member ids
// are stored actor URLs (resolved via resolveActorIdParams from a raw URI,
// publicId, or legacy colon/apurl_ form, then filtered to actual URIs), so
// `new URL` below is safe.
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
  // Drop ids that did not resolve to an actor URI BEFORE the insert. A
  // well-formed-but-unknown UUIDv7 (deleted actor, stale client cache, a status
  // publicId sent by mistake) comes back from the resolver as the bare uuid;
  // persisting it writes a phantom membership row for an actor that cannot
  // exist, and the `new URL` below then throws an unhandled TypeError — a 500
  // AFTER a partial write.
  //
  // Dropping is a no-op, not an error, matching how the legacy colon-form id
  // behaves: an id for an account this instance has never seen still resolves
  // to a URI and is added, because a collection may legitimately list a remote
  // actor that is only fetched later by the ingestion job. So there is no
  // "account not found" rejection to be consistent with, and an all-unresolvable
  // bulk request stays a `{}` success. The spec single-`account_id` form still
  // surfaces it: with no row written, the route's existing
  // `getCollectionItemByAccount` lookup finds nothing and answers 422.
  //
  // One batched publicId lookup for the whole list, not one per id.
  const targetActorIds = (
    await resolveActorIdParams(database, accountIds)
  ).filter(isActorUri)
  if (targetActorIds.length === 0) return

  const addedActorIds = await database.addCollectionMembers({
    id: collectionId,
    actorId: ownerActorId,
    targetActorIds
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

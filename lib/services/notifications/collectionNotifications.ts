import { Database } from '@/lib/database/types'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'

// A collection member is local iff it shares the owner's host. The owner is
// always a local actor (collections are owner-scoped), so its host is this
// server's host — no extra lookup needed. Remote members are notified over the
// wire by the (deferred) FEP-7aa9 FeatureRequest flow, not here.
const isLocalMember = (
  memberActorId: string,
  ownerActorId: string
): boolean => {
  try {
    return new URL(memberActorId).host === new URL(ownerActorId).host
  } catch {
    return false
  }
}

// Emit a collection notification (added_to_collection / collection_update) to
// each local member, sourced from the collection owner (the curator). The owner
// is skipped (a curator adding/curating themselves shouldn't self-notify), and
// the recipient's notification policy is applied via createNotificationWithPolicy.
// Notifications are grouped per collection.
const notifyCollectionMembers = async (
  database: Database,
  {
    collectionId,
    ownerActorId,
    memberActorIds,
    type
  }: {
    collectionId: string
    ownerActorId: string
    memberActorIds: string[]
    type: 'added_to_collection' | 'collection_update'
  }
): Promise<void> => {
  // Dedupe recipients — `addedActorIds` derives from the request's account_ids,
  // which may repeat — so a member is never notified twice for one call.
  const recipients = [
    ...new Set(
      memberActorIds.filter(
        (memberId) =>
          memberId !== ownerActorId && isLocalMember(memberId, ownerActorId)
      )
    )
  ]
  // allSettled (not all): every recipient's notification is awaited to
  // completion even if one rejects, so a single failure can't drop the others
  // or let the request return before they're persisted.
  await Promise.allSettled(
    recipients.map((recipient) =>
      createNotificationWithPolicy(database, {
        actorId: recipient,
        type,
        sourceActorId: ownerActorId,
        groupKey: `${type}:${collectionId}`
      })
    )
  )
}

// A curator added members to their collection: notify the newly-added local
// members.
export const notifyAddedToCollection = (
  database: Database,
  params: {
    collectionId: string
    ownerActorId: string
    addedActorIds: string[]
  }
): Promise<void> =>
  notifyCollectionMembers(database, {
    collectionId: params.collectionId,
    ownerActorId: params.ownerActorId,
    memberActorIds: params.addedActorIds,
    type: 'added_to_collection'
  })

// A collection's metadata changed: notify its approved local members (the ones
// publicly "in" the collection).
export const notifyCollectionUpdated = (
  database: Database,
  params: {
    collectionId: string
    ownerActorId: string
    memberActorIds: string[]
  }
): Promise<void> =>
  notifyCollectionMembers(database, {
    collectionId: params.collectionId,
    ownerActorId: params.ownerActorId,
    memberActorIds: params.memberActorIds,
    type: 'collection_update'
  })

import { ApprovedCollectionMember } from '@/lib/types/database/operations'
import { Collection } from '@/lib/types/domain/collection'
import { getLocalFeaturedCollectionId } from '@/lib/utils/activitypubId'
import {
  ACTIVITY_STREAM_URL,
  FEP_7AA9_CONTEXT_URL
} from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

// Build the FEP-7aa9 `FeaturedCollection` ActivityPub object for a local public
// collection. `FeaturedCollection` is a subtype of `OrderedCollection`; its
// items are `FeaturedItem` objects whose `featuredObject` is the AP id of an
// approved member (an actor) and `featuredObjectType` is the member's type.
//
// `members` are the collection's approved members (their canonical ActivityPub
// ids plus actor type). Consent is enforced upstream: only `approved` members
// are passed in, so a pending/revoked member never appears in the federated
// representation.
export const getFeaturedCollection = (
  ownerActorId: string,
  collection: Collection,
  members: ApprovedCollectionMember[]
) => ({
  '@context': [ACTIVITY_STREAM_URL, FEP_7AA9_CONTEXT_URL],
  id: getLocalFeaturedCollectionId(ownerActorId, collection.id),
  type: 'FeaturedCollection',
  attributedTo: ownerActorId,
  name: collection.title,
  ...(collection.description ? { summary: collection.description } : {}),
  ...(collection.topic
    ? { topic: { type: 'Hashtag', name: `#${collection.topic}` } }
    : {}),
  published: getISOTimeUTC(collection.createdAt),
  updated: getISOTimeUTC(collection.updatedAt),
  totalItems: members.length,
  orderedItems: members.map((member) => ({
    type: 'FeaturedItem',
    featuredObject: member.id,
    featuredObjectType: member.type
  }))
})

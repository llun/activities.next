import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'

import { ACTOR2_ID } from './seed/actor2'
import { ACTOR3_ID } from './seed/actor3'
import { ACTOR4_ID } from './seed/actor4'

type CollectionName = 'followers' | 'following'

interface BuilderParams {
  collection: CollectionName
  actorId: string
  itemActorIds?: string[]
  withPage?: boolean
  withContext?: boolean
  totalItems?: number
  includeFirst?: boolean
}

const MockActivityPubFollowCollection = ({
  collection,
  actorId,
  itemActorIds = [ACTOR2_ID, ACTOR3_ID, ACTOR4_ID],
  withPage = false,
  withContext = false,
  totalItems,
  includeFirst
}: BuilderParams) => {
  const resolvedTotalItems = totalItems ?? 8
  const shouldIncludeFirst = includeFirst ?? resolvedTotalItems > 0

  if (!withPage) {
    return {
      ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
      id: `${actorId}/${collection}`,
      type: 'OrderedCollection',
      totalItems: resolvedTotalItems,
      ...(shouldIncludeFirst
        ? { first: `${actorId}/${collection}?page=true` }
        : null)
    }
  }

  return {
    ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
    id: `${actorId}/${collection}?page=true`,
    type: 'OrderedCollectionPage',
    totalItems: resolvedTotalItems,
    partOf: `${actorId}/${collection}`,
    orderedItems: itemActorIds
  }
}

type CollectionParams = Omit<BuilderParams, 'collection'>

export const MockActivityPubFollowers = (params: CollectionParams) =>
  MockActivityPubFollowCollection({ ...params, collection: 'followers' })

export const MockActivityPubFollowing = (params: CollectionParams) =>
  MockActivityPubFollowCollection({ ...params, collection: 'following' })

import { ACTIVITY_STREAM_URL } from '../utils/activitystream'
import { ACTOR2_ID } from './seed/actor2'
import { ACTOR3_ID } from './seed/actor3'
import { ACTOR4_ID } from './seed/actor4'

interface Params {
  actorId: string
  followersActorIds?: string[]
  withPage?: boolean
  withContext?: boolean
  totalItems?: number
  includeFirst?: boolean
}

export const MockActivityPubFollowers = ({
  actorId,
  followersActorIds = [ACTOR2_ID, ACTOR3_ID, ACTOR4_ID],
  withPage = false,
  withContext = false,
  totalItems,
  includeFirst
}: Params) => {
  const resolvedTotalItems = totalItems ?? 8
  const shouldIncludeFirst = includeFirst ?? resolvedTotalItems > 0

  if (!withPage) {
    return {
      ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
      id: `${actorId}/followers`,
      type: 'OrderedCollection',
      totalItems: resolvedTotalItems,
      ...(shouldIncludeFirst
        ? { first: `${actorId}/followers?page=true` }
        : null)
    }
  }

  return {
    ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
    id: `${actorId}/followers?page=true`,
    type: 'OrderedCollectionPage',
    totalItems: resolvedTotalItems,
    partOf: `${actorId}/followers`,
    orderedItems: followersActorIds
  }
}

import { ACTIVITY_STREAM_URL } from '../utils/activitystream'
import { ACTOR2_ID } from './seed/actor2'
import { ACTOR3_ID } from './seed/actor3'
import { ACTOR4_ID } from './seed/actor4'

interface Params {
  actorId: string
  followingActorIds?: string[]
  withPage?: boolean
  withContext?: boolean
}

export const MockActivityPubFollowing = ({
  actorId,
  followingActorIds = [ACTOR2_ID, ACTOR3_ID, ACTOR4_ID],
  withPage = false,
  withContext = false
}: Params) => {
  if (!withPage) {
    return {
      ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
      id: `${actorId}/following`,
      type: 'OrderedCollection',
      totalItems: 8,
      first: `${actorId}/following?page=true`
    }
  }

  return {
    ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
    id: `${actorId}/following?page=true`,
    type: 'OrderedCollectionPage',
    totalItems: 8,
    partOf: `${actorId}/following`,
    orderedItems: followingActorIds
  }
}

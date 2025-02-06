import { ACTIVITY_STREAM_URL } from '../utils/jsonld/activitystream'
import { ACTOR2_ID } from './seed/actor2'
import { ACTOR3_ID } from './seed/actor3'
import { ACTOR4_ID } from './seed/actor4'

interface Params {
  actorId: string
  followersActorIds?: string[]
  withPage?: boolean
  withContext?: boolean
}

export const MockActivityPubFollowers = ({
  actorId,
  followersActorIds = [ACTOR2_ID, ACTOR3_ID, ACTOR4_ID],
  withPage = false,
  withContext = false
}: Params) => {
  if (!withPage) {
    return {
      ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
      id: `${actorId}/followers`,
      type: 'OrderedCollection',
      totalItems: 8,
      first: `${actorId}/followers?page=true`
    }
  }

  return {
    ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
    id: `${actorId}/followers?page=true`,
    type: 'OrderedCollectionPage',
    totalItems: 8,
    partOf: `${actorId}/followers`,
    orderedItems: followersActorIds
  }
}

import crypto from 'crypto'

import { FollowRequest } from '../activities/actions/follow'
import { ACTIVITY_STREAM_URL } from '../jsonld/activitystream'

interface Params {
  actorId: string
  targetActorId: string
}
export const MockFollowRequest = ({
  actorId,
  targetActorId
}: Params): FollowRequest => {
  return {
    '@context': ACTIVITY_STREAM_URL,
    type: 'Follow',
    id: crypto.randomUUID(),
    actor: actorId,
    object: targetActorId
  }
}

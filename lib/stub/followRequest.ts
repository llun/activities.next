import crypto from 'crypto'

import { AcceptFollow } from '../activities/actions/acceptFollow'
import { FollowRequest } from '../activities/actions/follow'
import { RejectFollow } from '../activities/actions/rejectFollow'
import { ACTIVITY_STREAM_URL } from '../jsonld/activitystream'

interface FollowRequestParams {
  withContext?: boolean
  actorId: string
  targetActorId: string
  id?: string
}
export const MockFollowRequest = ({
  withContext = true,
  actorId,
  targetActorId,
  id = `https://llun.test/${crypto.randomUUID()}`
}: FollowRequestParams): FollowRequest => {
  return {
    ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
    type: 'Follow',
    id,
    actor: actorId,
    object: targetActorId
  }
}

interface FollowRequestResponseParams {
  actorId: string
  targetActorId: string
  followId?: string
  followResponseStatus: 'Accept' | 'Reject'
}
export const MockFollowRequestResponse = ({
  actorId,
  targetActorId,
  followResponseStatus,
  followId = `https://llun.test/${crypto.randomUUID()}`
}: FollowRequestResponseParams): AcceptFollow | RejectFollow => {
  return {
    '@context': ACTIVITY_STREAM_URL,
    id: `${targetActorId}/request`,
    actor: targetActorId,
    type: followResponseStatus,
    object: MockFollowRequest({
      withContext: false,
      targetActorId,
      actorId,
      id: followId
    })
  }
}

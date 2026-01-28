import crypto from 'crypto'

import { UndoFollow } from '@/lib/activities/undoFollow'
import { UndoAction } from '@/lib/types/activitypub/activities'

import { MockFollowRequest } from './followRequest'

interface UndoFollowRequestParams {
  withContext?: boolean
  actorId: string
  targetActorId: string
  followId?: string
}

export const MockUndoFollowRequest = ({
  withContext,
  actorId,
  targetActorId,
  followId = `https://llun.test/${crypto.randomUUID()}`
}: UndoFollowRequestParams): UndoFollow => ({
  ...(withContext
    ? { '@context': 'https://www.w3.org/ns/activitystreams' }
    : null),
  id: `${targetActorId}/request#undo`,
  actor: actorId,
  type: UndoAction,
  object: MockFollowRequest({
    withContext: false,
    actorId,
    targetActorId,
    id: followId
  })
})

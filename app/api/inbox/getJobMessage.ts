import isMatch from 'lodash/isMatch'

import { StatusActivity } from '@/lib/activities/statusAction'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CREATE_NOTE_JOB_NAME,
  CREATE_POLL_JOB_NAME,
  CREATE_POLL_VOTE_JOB_NAME,
  DELETE_OBJECT_JOB_NAME,
  UPDATE_NOTE_JOB_NAME,
  UPDATE_POLL_JOB_NAME
} from '@/lib/jobs/names'
import type { JobMessage } from '@/lib/services/queue/type'
import { ENTITY_TYPE_NOTE, ENTITY_TYPE_QUESTION } from '@/lib/types/activitypub'
import {
  AnnounceAction,
  CreateAction,
  DeleteAction,
  UndoAction,
  UpdateAction
} from '@/lib/types/activitypub/activities'
import { extractActivityPubId, normalizeActorId } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { isRecord } from '@/lib/utils/typeGuards'

const ENTITY_TYPE_IMAGE = 'Image'
const ENTITY_TYPE_PAGE = 'Page'
const ENTITY_TYPE_ARTICLE = 'Article'
const ENTITY_TYPE_VIDEO = 'Video'

const NOTE_TYPES = [
  ENTITY_TYPE_NOTE,
  ENTITY_TYPE_IMAGE,
  ENTITY_TYPE_PAGE,
  ENTITY_TYPE_ARTICLE,
  ENTITY_TYPE_VIDEO
]

const createJobMessage = ({
  data,
  id,
  name,
  verifiedSenderActorId
}: JobMessage) => {
  const normalizedVerifiedSenderActorId = normalizeActorId(
    verifiedSenderActorId
  )

  return {
    id,
    name,
    data,
    ...(normalizedVerifiedSenderActorId
      ? { verifiedSenderActorId: normalizedVerifiedSenderActorId }
      : {})
  }
}

const activityActorMismatch = (
  activity: StatusActivity,
  verifiedSenderActorId?: string
) => {
  if (!verifiedSenderActorId) return false

  const normalizedVerifiedSenderActorId = normalizeActorId(
    verifiedSenderActorId
  )
  const normalizedActivityActorId = normalizeActorId(
    extractActivityPubId(activity.actor)
  )

  return (
    !normalizedVerifiedSenderActorId ||
    !normalizedActivityActorId ||
    normalizedActivityActorId !== normalizedVerifiedSenderActorId
  )
}

const createObjectActorMismatch = (
  object: unknown,
  verifiedSenderActorId?: string
) => {
  if (!verifiedSenderActorId || !isRecord(object)) return false

  const normalizedVerifiedSenderActorId = normalizeActorId(
    verifiedSenderActorId
  )
  if (!normalizedVerifiedSenderActorId) return true

  const objectActorIds = [
    extractActivityPubId(object.attributedTo),
    extractActivityPubId(object.actor)
  ].filter((actorId): actorId is string => Boolean(actorId))

  if (objectActorIds.length === 0) return true

  return objectActorIds.some(
    (actorId) => normalizeActorId(actorId) !== normalizedVerifiedSenderActorId
  )
}

export const getJobMessage = (
  activity: StatusActivity,
  verifiedSenderActorId?: string
) => {
  const deduplicationId = getHashFromString(activity.id)

  if (activity.type === CreateAction) {
    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      NOTE_TYPES.includes(activity.object.type)
    ) {
      if (createObjectActorMismatch(activity.object, verifiedSenderActorId)) {
        return null
      }

      if (
        activity.object.type === ENTITY_TYPE_NOTE &&
        activity.object.inReplyTo &&
        'name' in activity.object &&
        activity.object.name &&
        !activity.object.content
      ) {
        return createJobMessage({
          id: deduplicationId,
          name: CREATE_POLL_VOTE_JOB_NAME,
          data: activity.object,
          verifiedSenderActorId
        })
      }

      return createJobMessage({
        id: deduplicationId,
        name: CREATE_NOTE_JOB_NAME,
        data: activity.object,
        verifiedSenderActorId
      })
    }

    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      activity.object.type === ENTITY_TYPE_QUESTION
    ) {
      if (createObjectActorMismatch(activity.object, verifiedSenderActorId)) {
        return null
      }

      return createJobMessage({
        id: deduplicationId,
        name: CREATE_POLL_JOB_NAME,
        data: activity.object,
        verifiedSenderActorId
      })
    }
  }

  if (activity.type === UpdateAction) {
    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      activity.object.type === ENTITY_TYPE_QUESTION
    ) {
      if (createObjectActorMismatch(activity.object, verifiedSenderActorId)) {
        return null
      }

      return createJobMessage({
        id: deduplicationId,
        name: UPDATE_POLL_JOB_NAME,
        data: activity.object,
        verifiedSenderActorId
      })
    }

    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      NOTE_TYPES.includes(activity.object.type)
    ) {
      if (createObjectActorMismatch(activity.object, verifiedSenderActorId)) {
        return null
      }

      return createJobMessage({
        id: deduplicationId,
        name: UPDATE_NOTE_JOB_NAME,
        data: activity.object,
        verifiedSenderActorId
      })
    }
  }

  if (isMatch(activity, { type: AnnounceAction })) {
    if (activityActorMismatch(activity, verifiedSenderActorId)) {
      return null
    }

    return createJobMessage({
      id: deduplicationId,
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: activity,
      verifiedSenderActorId
    })
  }

  if (
    isMatch(activity, { type: UndoAction, object: { type: AnnounceAction } }) ||
    isMatch(activity, { type: DeleteAction })
  ) {
    if (activityActorMismatch(activity, verifiedSenderActorId)) {
      return null
    }

    return createJobMessage({
      id: deduplicationId,
      name: DELETE_OBJECT_JOB_NAME,
      data: activity.object,
      verifiedSenderActorId
    })
  }

  return null
}

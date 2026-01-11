import { ENTITY_TYPE_NOTE, ENTITY_TYPE_QUESTION } from '@llun/activities.schema'
import isMatch from 'lodash/isMatch'

import { StatusActivity } from '@/lib/activities/actions/status'
import {
  AnnounceAction,
  CreateAction,
  DeleteAction,
  UndoAction,
  UpdateAction
} from '@/lib/activities/actions/types'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CREATE_NOTE_JOB_NAME,
  CREATE_POLL_JOB_NAME,
  CREATE_POLL_VOTE_JOB_NAME,
  DELETE_OBJECT_JOB_NAME,
  UPDATE_NOTE_JOB_NAME,
  UPDATE_POLL_JOB_NAME
} from '@/lib/jobs/names'
import { getHashFromString } from '@/lib/utils/getHashFromString'

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

export const getJobMessage = (activity: StatusActivity) => {
  const deduplicationId = getHashFromString(activity.id)

  if (activity.type === CreateAction) {
    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      NOTE_TYPES.includes(activity.object.type)
    ) {
      if (
        activity.object.type === ENTITY_TYPE_NOTE &&
        activity.object.inReplyTo &&
        'name' in activity.object &&
        activity.object.name &&
        !activity.object.content
      ) {
        return {
          id: deduplicationId,
          name: CREATE_POLL_VOTE_JOB_NAME,
          data: activity.object
        }
      }

      return {
        id: deduplicationId,
        name: CREATE_NOTE_JOB_NAME,
        data: activity.object
      }
    }

    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      activity.object.type === ENTITY_TYPE_QUESTION
    ) {
      return {
        id: deduplicationId,
        name: CREATE_POLL_JOB_NAME,
        data: activity.object
      }
    }
  }

  if (activity.type === UpdateAction) {
    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      activity.object.type === ENTITY_TYPE_QUESTION
    ) {
      return {
        id: deduplicationId,
        name: UPDATE_POLL_JOB_NAME,
        data: activity.object
      }
    }

    if (
      typeof activity.object === 'object' &&
      activity.object !== null &&
      NOTE_TYPES.includes(activity.object.type)
    ) {
      return {
        id: deduplicationId,
        name: UPDATE_NOTE_JOB_NAME,
        data: activity.object
      }
    }
  }

  if (isMatch(activity, { type: AnnounceAction })) {
    return {
      id: deduplicationId,
      name: CREATE_ANNOUNCE_JOB_NAME,
      data: activity
    }
  }

  if (
    isMatch(activity, { type: UndoAction, object: { type: AnnounceAction } }) ||
    isMatch(activity, { type: DeleteAction })
  ) {
    return {
      id: deduplicationId,
      name: DELETE_OBJECT_JOB_NAME,
      data: activity.object
    }
  }

  return null
}

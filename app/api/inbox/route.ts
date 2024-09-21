import { ENTITY_TYPE_NOTE, ENTITY_TYPE_QUESTION } from '@llun/activities.schema'
import isMatch from 'lodash/isMatch'
import crypto from 'node:crypto'

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
  DELETE_OBJECT_JOB_NAME,
  UPDATE_NOTE_JOB_NAME,
  UPDATE_POLL_JOB_NAME
} from '@/lib/jobs/names'
import { ActivityPubVerifySenderGuard } from '@/lib/services/guards/ActivityPubVerifyGuard'
import { getQueue } from '@/lib/services/queue'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { compact } from '@/lib/utils/jsonld'
import {
  DEFAULT_202,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const getJobMessage = (activity: StatusActivity) => {
  const deduplicationId = crypto
    .createHash('sha256')
    .update(JSON.stringify(activity.id))
    .digest('hex')
  if (
    isMatch(activity, {
      type: CreateAction,
      object: { type: ENTITY_TYPE_NOTE }
    })
  ) {
    return {
      id: deduplicationId,
      name: CREATE_NOTE_JOB_NAME,
      data: activity.object
    }
  }

  if (
    isMatch(activity, {
      type: CreateAction,
      object: { type: ENTITY_TYPE_QUESTION }
    })
  ) {
    return {
      id: deduplicationId,
      name: CREATE_POLL_JOB_NAME,
      data: activity.object
    }
  }

  if (
    isMatch(activity, {
      type: UpdateAction,
      object: { type: ENTITY_TYPE_QUESTION }
    })
  ) {
    return {
      id: deduplicationId,
      name: UPDATE_POLL_JOB_NAME,
      data: activity.object
    }
  }

  if (
    isMatch(activity, {
      type: UpdateAction,
      object: { type: ENTITY_TYPE_NOTE }
    })
  ) {
    return {
      id: deduplicationId,
      name: UPDATE_NOTE_JOB_NAME,
      data: activity.object
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

export const POST = ActivityPubVerifySenderGuard(async (request) => {
  const body = await request.json()
  const activity = (await compact(body)) as StatusActivity
  const jobMessage = getJobMessage(activity)
  if (!jobMessage) {
    return apiErrorResponse(404)
  }

  await getQueue().publish(jobMessage)
  return apiResponse(request, CORS_HEADERS, DEFAULT_202, 202)
})

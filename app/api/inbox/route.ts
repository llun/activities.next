import { ENTITY_TYPE_NOTE, ENTITY_TYPE_QUESTION } from '@llun/activities.schema'
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

export const POST = ActivityPubVerifySenderGuard(async (request, context) => {
  const { storage } = context
  const body = await request.json()
  const activity = (await compact(body)) as StatusActivity
  const deduplicationId = crypto
    .createHash('sha256')
    .update(JSON.stringify(activity.id))
    .digest('hex')
  switch (activity.type) {
    case CreateAction: {
      const jobName = ((name: string) => {
        switch (name) {
          case ENTITY_TYPE_NOTE:
            return CREATE_NOTE_JOB_NAME
          case ENTITY_TYPE_QUESTION:
            return CREATE_POLL_JOB_NAME
          default:
            return null
        }
      })(activity.object.type)
      if (!jobName) {
        return apiErrorResponse(404)
      }
      await getQueue().publish({
        id: deduplicationId,
        name: jobName,
        data: activity.object
      })
      return apiResponse(request, CORS_HEADERS, DEFAULT_202, 202)
    }
    case UpdateAction: {
      switch (activity.object.type) {
        case ENTITY_TYPE_QUESTION: {
          await getQueue().publish({
            id: deduplicationId,
            name: UPDATE_POLL_JOB_NAME,
            data: activity.object
          })
          break
        }
        case ENTITY_TYPE_NOTE: {
          await getQueue().publish({
            id: deduplicationId,
            name: UPDATE_NOTE_JOB_NAME,
            data: activity.object
          })
          break
        }
      }
      return apiResponse(request, CORS_HEADERS, DEFAULT_202, 202)
    }
    case AnnounceAction: {
      await getQueue().publish({
        id: deduplicationId,
        name: CREATE_ANNOUNCE_JOB_NAME,
        data: activity
      })
      return apiResponse(request, CORS_HEADERS, DEFAULT_202, 202)
    }
    case UndoAction: {
      switch (activity.object.type) {
        case AnnounceAction: {
          const statusId = activity.object.id
          await storage.deleteStatus({ statusId })
          break
        }
      }
      return apiResponse(request, CORS_HEADERS, DEFAULT_202, 202)
    }
    case DeleteAction: {
      // TODO: Handle delete object type string
      if (typeof activity.object === 'string') {
        return apiResponse(request, CORS_HEADERS, DEFAULT_202, 202)
      }

      const id = activity.object.id
      await storage.deleteStatus({ statusId: id })
      return apiResponse(request, CORS_HEADERS, DEFAULT_202, 202)
    }
    default:
      return apiErrorResponse(404)
  }
})

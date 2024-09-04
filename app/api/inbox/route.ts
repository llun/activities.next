import crypto from 'node:crypto'

import { createPoll } from '@/lib/actions/createPoll'
import { updateNote } from '@/lib/actions/updateNote'
import { updatePoll } from '@/lib/actions/updatePoll'
import { StatusActivity } from '@/lib/activities/actions/status'
import {
  AnnounceAction,
  CreateAction,
  DeleteAction,
  UndoAction,
  UpdateAction
} from '@/lib/activities/actions/types'
import { QuestionEntity } from '@/lib/activities/entities/question'
import { CREATE_ANNOUNCE_JOB_NAME } from '@/lib/jobs/createAnnounceJob'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/createNoteJob'
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
      switch (activity.object.type) {
        case 'Note': {
          await getQueue().publish({
            id: deduplicationId,
            name: CREATE_NOTE_JOB_NAME,
            data: activity.object
          })
          break
        }
        case QuestionEntity: {
          await createPoll({ storage, question: activity.object })
          break
        }
      }
      return apiResponse(request, CORS_HEADERS, DEFAULT_202, 202)
    }
    case UpdateAction: {
      switch (activity.object.type) {
        case QuestionEntity: {
          await updatePoll({ storage, question: activity.object })
          break
        }
        case 'Note': {
          await updateNote({ storage, note: activity.object })
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

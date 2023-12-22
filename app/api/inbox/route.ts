import { announce } from '@/lib/actions/announce'
import { createNote } from '@/lib/actions/createNote'
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
import { NoteEntity } from '@/lib/activities/entities/note'
import { QuestionEntity } from '@/lib/activities/entities/question'
import { DEFAULT_202, ERROR_404 } from '@/lib/errors'
import { compact } from '@/lib/jsonld'
import { ActivityPubVerifySenderGuard } from '@/lib/services/guards/ActivityPubVerifyGuard'

export const POST = ActivityPubVerifySenderGuard(async (request, context) => {
  const { storage } = context
  const body = await request.json()
  const activity = (await compact(body)) as StatusActivity
  switch (activity.type) {
    case CreateAction: {
      switch (activity.object.type) {
        case NoteEntity: {
          await createNote({ storage, note: activity.object })
          break
        }
        case QuestionEntity: {
          await createPoll({ storage, question: activity.object })
          break
        }
      }
      return Response.json(DEFAULT_202, { status: 202 })
    }
    case UpdateAction: {
      switch (activity.object.type) {
        case QuestionEntity: {
          await updatePoll({ storage, question: activity.object })
          break
        }
        case NoteEntity: {
          await updateNote({ storage, note: activity.object })
          break
        }
      }
      return Response.json(DEFAULT_202, { status: 202 })
    }
    case AnnounceAction: {
      await announce({ storage, status: activity })
      return Response.json(DEFAULT_202, { status: 202 })
    }
    case UndoAction: {
      switch (activity.object.type) {
        case AnnounceAction: {
          const statusId = activity.object.id
          await storage.deleteStatus({ statusId })
          break
        }
      }
      return Response.json(DEFAULT_202, { status: 202 })
    }
    case DeleteAction: {
      // TODO: Handle delete object type string
      if (typeof activity.object === 'string') {
        return Response.json(DEFAULT_202, { status: 202 })
      }

      const id = activity.object.id
      await storage.deleteStatus({ statusId: id })
      return Response.json(DEFAULT_202, { status: 202 })
    }
    default:
      return Response.json(ERROR_404, { status: 404 })
  }
})

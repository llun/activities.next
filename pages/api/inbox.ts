import type { NextApiHandler, NextApiResponse } from 'next'

import { announce } from '../../lib/actions/announce'
import { createNote } from '../../lib/actions/createNote'
import { createPoll } from '../../lib/actions/createPoll'
import { updateNote } from '../../lib/actions/updateNote'
import { updatePoll } from '../../lib/actions/updatePoll'
import { StatusActivity } from '../../lib/activities/actions/status'
import {
  AnnounceAction,
  CreateAction,
  DeleteAction,
  UndoAction,
  UpdateAction
} from '../../lib/activities/actions/types'
import { NoteEntity } from '../../lib/activities/entities/note'
import { QuestionEntity } from '../../lib/activities/entities/question'
import { ERROR_404, ERROR_500 } from '../../lib/errors'
import { activitiesGuard } from '../../lib/guard'
import { compact } from '../../lib/jsonld'
import { getStorage } from '../../lib/storage'
import { Storage } from '../../lib/storage/types'
import { getSpan } from '../../lib/trace'

const handlePost = async (
  storage: Storage,
  activity: StatusActivity,
  res: NextApiResponse
) => {
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
      res.status(202).send('')
      return
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
      res.status(202).send('')
      return
    }
    case AnnounceAction: {
      await announce({ storage, status: activity })
      res.status(202).send('')
      return
    }
    case UndoAction: {
      switch (activity.object.type) {
        case AnnounceAction: {
          const statusId = activity.object.id
          await storage.deleteStatus({ statusId })
          break
        }
      }
      res.status(202).send('')
      return
    }
    case DeleteAction: {
      // TODO: Handle delete object type string
      if (typeof activity.object === 'string') {
        res.status(202).send('')
        return
      }

      const id = activity.object.id
      await storage.deleteStatus({ statusId: id })
      res.status(202).send('')
      return
    }
    default:
      res.status(404).send(ERROR_404)
  }
}

const ApiHandler: NextApiHandler = activitiesGuard(
  async (req, res) => {
    const storage = await getStorage()
    if (!storage) {
      res.status(500).send(ERROR_500)
      return
    }

    switch (req.method) {
      case 'POST': {
        const span = getSpan('api', 'handlePost')
        const requestBody =
          typeof req.body === 'string' ? JSON.parse(req.body) : req.body
        const body = (await compact(requestBody)) as StatusActivity

        await handlePost(storage, body, res)
        span.end()
        return
      }
      default:
        res.status(404).send(ERROR_404)
    }
  },
  ['POST']
)

export default ApiHandler

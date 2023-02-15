import * as Sentry from '@sentry/node'
import type { NextApiHandler, NextApiResponse } from 'next'

import { announce } from '../../lib/actions/announce'
import { createNote } from '../../lib/actions/createNote'
import { StatusActivity } from '../../lib/activities/actions/status'
import {
  AnnounceAction,
  CreateAction,
  DeleteAction,
  UndoAction
} from '../../lib/activities/actions/types'
import { NoteEntity } from '../../lib/activities/entities/note'
import { QuestionEntity } from '../../lib/activities/entities/question'
import { activitiesGuard } from '../../lib/guard'
import { compact } from '../../lib/jsonld'
import { ERROR_404, ERROR_500 } from '../../lib/responses'
import { getStorage } from '../../lib/storage'
import { Storage } from '../../lib/storage/types'

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
          break
        }
      }
      return res.status(202).send('')
    }
    case AnnounceAction: {
      await announce({ storage, status: activity })
      return res.status(202).send('')
    }
    case UndoAction: {
      switch (activity.object.type) {
        case AnnounceAction: {
          const statusId = activity.object.id
          await storage.deleteStatus({ statusId })
          break
        }
      }
      return res.status(202).send('')
    }
    case DeleteAction: {
      // TODO: Handle delete object type string
      if (typeof activity.object === 'string') {
        return res.status(202).send('')
      }

      const id = activity.object.id
      await storage.deleteStatus({ statusId: id })
      return res.status(202).send('')
    }
    default:
      return res.status(404).send(ERROR_404)
  }
}

const ApiHandler: NextApiHandler = activitiesGuard(
  async (req, res) => {
    const transaction = Sentry.startTransaction({ name: 'inbox' })

    const storage = await getStorage()
    if (!storage) {
      return res.status(500).send(ERROR_500)
    }

    switch (req.method) {
      case 'POST': {
        const span = transaction.startChild({ op: 'post' })
        const requestBody =
          typeof req.body === 'string' ? JSON.parse(req.body) : req.body
        const body = (await compact(requestBody)) as StatusActivity

        await handlePost(storage, body, res)
        span.finish()
        transaction.finish()
        return
      }
      default:
        return res.status(404).send(ERROR_404)
    }
  },
  ['POST']
)

export default ApiHandler

import type { NextApiHandler, NextApiResponse } from 'next'

import { announce } from '../../lib/actions/announce'
import { createNote } from '../../lib/actions/createNote'
import { StatusActivity } from '../../lib/activities/actions/status'
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
    case 'Create': {
      switch (activity.object.type) {
        case 'Note': {
          console.log('Create note from here?')
          await createNote({ storage, note: activity.object })
          break
        }
      }
      return res.status(202).send('')
    }
    case 'Announce': {
      await announce({ storage, status: activity })
      return res.status(202).send('')
    }
    case 'Undo': {
      switch (activity.object.type) {
        case 'Announce': {
          const statusId = activity.object.id
          await storage.deleteStatus({ statusId })
          break
        }
      }
      return res.status(202).send('')
    }
    case 'Delete': {
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
    const storage = await getStorage()
    if (!storage) {
      return res.status(500).send(ERROR_500)
    }

    switch (req.method) {
      case 'POST': {
        const requestBody =
          typeof req.body === 'string' ? JSON.parse(req.body) : req.body
        const body = (await compact(requestBody)) as StatusActivity
        return await handlePost(storage, body, res)
      }
      default:
        return res.status(404).send(ERROR_404)
    }
  },
  ['POST']
)

export default ApiHandler

import type { NextApiHandler } from 'next'

import { announce } from '../../lib/actions/announce'
import { createNote } from '../../lib/actions/createNote'
import { StatusActivity } from '../../lib/activities/actions/status'
import { activitiesGuard } from '../../lib/guard'
import { compact } from '../../lib/jsonld'
import { ERROR_404, ERROR_500 } from '../../lib/responses'
import { getStorage } from '../../lib/storage'

const ApiHandler: NextApiHandler = activitiesGuard(
  async (req, res) => {
    const requestBody =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const body = (await compact(requestBody)) as StatusActivity
    const storage = await getStorage()
    if (!storage) {
      return res.status(500).send(ERROR_500)
    }

    switch (body.type) {
      case 'Create': {
        switch (body.object.type) {
          case 'Note': {
            await createNote({ storage, note: body.object })
            break
          }
        }
        return res.status(202).send('')
      }
      case 'Announce': {
        await announce({ storage, status: body })
        return res.status(202).send('')
      }
      case 'Undo': {
        switch (body.object.type) {
          case 'Announce': {
            const statusId = body.object.id
            await storage.deleteStatus({ statusId })
            break
          }
        }
        return res.status(202).send('')
      }
      case 'Delete': {
        // TODO: Handle delete object type string
        if (typeof body.object === 'string') {
          return res.status(202).send('')
        }

        const id = body.object.id
        await storage.deleteStatus({ statusId: id })
        return res.status(202).send('')
      }
      default:
        return res.status(404).send(ERROR_404)
    }
  },
  ['POST']
)

export default ApiHandler

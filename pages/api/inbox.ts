import type { NextApiHandler } from 'next'

import { StatusActivity } from '../../lib/activities/actions/status'
import { Note } from '../../lib/activities/entities/note'
import { Question } from '../../lib/activities/entities/question'
import { ERROR_404, ERROR_500 } from '../../lib/errors'
import { activitiesGuard } from '../../lib/guard'
import { fromJson } from '../../lib/models/status'
import { getStorage } from '../../lib/storage'
import { Storage } from '../../lib/storage/types'

interface HandleCreateParams {
  storage: Storage
  object: Note | Question
}
export const handleCreate = async ({ storage, object }: HandleCreateParams) => {
  const status = fromJson(object)
  await storage.createStatus({ status })
  return {
    status: 202,
    data: ''
  }
}

const ApiHandler: NextApiHandler = activitiesGuard(
  async (req, res) => {
    const body = JSON.parse(req.body) as StatusActivity
    const storage = await getStorage()
    if (!storage) {
      return res.status(500).send(ERROR_500)
    }

    switch (body.type) {
      case 'Create': {
        const { status, data } = await handleCreate({
          storage,
          object: body.object
        })
        return res.status(status).send(data)
      }
      default:
        return res.status(404).send(ERROR_404)
    }
  },
  ['POST']
)

export default ApiHandler

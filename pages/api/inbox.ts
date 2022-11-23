import type { NextApiHandler } from 'next'

import { StatusActivity } from '../../lib/activities/actions/status'
import { ERROR_404 } from '../../lib/errors'
import { activitiesGuard } from '../../lib/guard'
import { fromJson } from '../../lib/models/status'
import { getStorage } from '../../lib/storage'

const ApiHandler: NextApiHandler = activitiesGuard(
  async (req, res) => {
    const body = JSON.parse(req.body) as StatusActivity
    const storage = await getStorage()
    switch (body.type) {
      case 'Create': {
        storage?.createStatus({ status: fromJson(body.object) })
        return res.status(202).send('')
      }
      default:
        return res.status(404).send(ERROR_404)
    }
  },
  ['POST']
)

export default ApiHandler
